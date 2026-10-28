import { ClientResponseError } from 'pocketbase';
import { auth } from '../auth.svelte';
import { changedFields } from '../diff';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import type { Lead } from '../types';
import { compareActivities, matchesFilter } from './format';
import type { Activity, ActivityData, ActivityFilter } from './types';

/**
 * The activities of ONE lead, live (filter `lead = {:id}` for list and realtime, so a lead
 * with hundreds of activities only loads its own). Also keeps the lead itself live: the
 * form offers the lead's contacts.
 *
 * Writes wait for the server (uploads can take a while and may fail), then merge the
 * response; the realtime event for our own change is deduplicated by `updated`.
 */
export class ActivityStore {
	/** newest first (compareActivities) */
	list = $state<Activity[]>([]);
	lead = $state<Lead | null>(null);
	loaded = $state(false);
	error = $state('');
	/** the lead doesn't exist (any more) */
	gone = $state(false);

	constructor(readonly leadId: string) {}

	/** Starts loading + realtime; returns the teardown (call from a component's $effect). */
	sync(): () => void {
		const filter = pb.filter('lead = {:id}', { id: this.leadId });
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('activities')
					.subscribe<Activity>('*', (e) => handle(() => this.onEvent(e.action, e.record)), {
						filter
					}),
				pb.collection('leads').subscribe<Lead>(this.leadId, (e) =>
					handle(() => {
						if (e.record.id !== this.leadId) return;
						if (e.action === 'delete') {
							this.gone = true;
							this.lead = null;
						} else this.lead = e.record;
					})
				)
			],
			fetch: () =>
				Promise.all([
					pb
						.collection('activities')
						.getFullList<Activity>({ filter, sort: '-occurred_at,-created' }),
					pb.collection('leads').getOne<Lead>(this.leadId)
				]),
			apply: ([list, lead]) => {
				this.reconcile(list);
				this.lead = lead;
				this.gone = false;
				this.error = '';
			},
			onError: (err) => {
				// liveSync checked the session before loading, so a 404 means the lead is gone
				if (err instanceof ClientResponseError && err.status === 404) {
					this.gone = true;
					this.lead = null;
					this.list = [];
				} else this.error = errorMessage(err);
			},
			onSettled: () => (this.loaded = true)
		});
	}

	/** the activities matching a type filter, still newest first */
	visible(filter: ActivityFilter): Activity[] {
		return filter === 'all' ? this.list : this.list.filter((a) => matchesFilter(a, filter));
	}

	get(id: string): Activity | undefined {
		return this.list.find((a) => a.id === id);
	}

	private index(id: string) {
		return this.list.findIndex((a) => a.id === id);
	}

	private insert(rec: Activity) {
		const i = this.list.findIndex((a) => compareActivities(a, rec) > 0);
		this.list.splice(i === -1 ? this.list.length : i, 0, rec);
	}

	/** replace one record (its position may change with occurred_at); single splices only */
	private put(rec: Activity) {
		const i = this.index(rec.id);
		if (i !== -1) this.list.splice(i, 1);
		this.insert(rec);
	}

	private onEvent(action: string, rec: Activity) {
		const i = this.index(rec.id);
		if (action === 'delete' || rec.lead !== this.leadId) {
			if (i !== -1) this.list.splice(i, 1);
			return;
		}
		// our own create/update came back, or an older event replayed after a load
		if (i !== -1 && this.list[i].updated >= rec.updated) return;
		this.put(rec);
	}

	/**
	 * After a (re)load: unchanged records keep their object, so 500 items don't all
	 * re-render (and re-sanitise) after every reconnect.
	 */
	private reconcile(fresh: Activity[]) {
		const cur = new Map(this.list.map((a) => [a.id, a]));
		this.list = fresh
			.map((r) => {
				const c = cur.get(r.id);
				return c && c.updated === r.updated ? c : r;
			})
			.sort(compareActivities);
	}

	/**
	 * A failed write may mean our session became invalid (PocketBase then answers as for a
	 * guest: 400/403/404): check it so the user lands on the login. Rethrows either way.
	 */
	private async guard<R>(fn: () => Promise<R>): Promise<R> {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof ClientResponseError && [400, 403, 404].includes(err.status)) {
				await auth.refresh();
			}
			throw err;
		}
	}

	/** Creates an activity of this lead as the current user. Throws on failure. */
	async create(data: ActivityData, files: File[] = []): Promise<Activity> {
		const body: Record<string, unknown> = {
			...data,
			lead: this.leadId,
			author: pb.authStore.record?.id ?? ''
		};
		if (files.length) body.attachments = files;
		const rec = await this.guard(() => pb.collection('activities').create<Activity>(body));
		// dedupe against the realtime create event (which may have come first)
		if (this.index(rec.id) === -1) this.insert(rec);
		return rec;
	}

	/**
	 * Saves only what changed against `initial` (the values when the form opened), plus
	 * attachments to add / remove (stored names). Resolves null if there was nothing to
	 * save. Throws on failure.
	 */
	async update(
		id: string,
		initial: ActivityData,
		current: ActivityData,
		addFiles: File[] = [],
		removeFiles: string[] = []
	): Promise<Activity | null> {
		const body: Record<string, unknown> = changedFields(initial, current);
		if (addFiles.length) body['attachments+'] = addFiles;
		if (removeFiles.length) body['attachments-'] = removeFiles;
		if (Object.keys(body).length === 0) return null;
		const rec = await this.guard(() => pb.collection('activities').update<Activity>(id, body));
		const i = this.index(id);
		// deleted by someone else meanwhile: don't resurrect it; a newer save by someone
		// else that arrived by realtime wins (PocketBase date strings compare as strings)
		if (i !== -1 && this.list[i].updated <= rec.updated) this.put(rec);
		return rec;
	}

	/** Deletes an activity; sets `error` on failure and resolves whether it is gone. */
	async remove(id: string): Promise<boolean> {
		try {
			await this.guard(() => pb.collection('activities').delete(id));
		} catch (err) {
			// already deleted by someone else (and our session is fine): that's the goal
			const gone = err instanceof ClientResponseError && err.status === 404 && auth.loggedIn;
			if (!gone) {
				this.error = errorMessage(err);
				return false;
			}
		}
		const i = this.index(id);
		if (i !== -1) this.list.splice(i, 1);
		return true;
	}
}
