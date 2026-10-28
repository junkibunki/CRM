import { SvelteMap } from 'svelte/reactivity';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import { isNewer, LAST_ACTIVITY_FIELDS, type LastActivity } from './format';

/**
 * The latest activity of every lead of one pipeline (F4), for cards and the quick view.
 * Loaded with ONE query from the view `lead_last_activity` (`lead.column.board = {:id}`).
 * Views send no realtime events, so this follows `activities` of the pipeline (excerpt
 * instead of the HTML body): a newer activity replaces the entry directly; deleting the
 * latest one, or moving it back in time, re-reads just that lead from the view.
 */
export class LastActivityStore {
	/** lead id -> its latest activity (only leads that have one) */
	readonly latest = new SvelteMap<string, LastActivity>();
	loaded = $state(false);
	error = $state('');

	/** bumped by every event of a lead: a re-read that was overtaken reads again */
	private gen = new Map<string, number>();
	private stopped = false;

	constructor(readonly boardId: string) {}

	sync(): () => void {
		this.stopped = false;
		const filter = pb.filter('lead.column.board = {:id}', { id: this.boardId });
		const stop = liveSync({
			subscribe: (handle) => [
				pb
					.collection('activities')
					.subscribe<LastActivity>('*', (e) => handle(() => this.onEvent(e.action, e.record)), {
						filter,
						fields: LAST_ACTIVITY_FIELDS
					})
			],
			fetch: () =>
				pb.collection('lead_last_activity').getFullList<LastActivity>({ filter, fields: LAST_ACTIVITY_FIELDS }),
			apply: (list) => {
				this.replace(list);
				this.error = '';
				this.loaded = true;
			},
			onError: (err) => (this.error = errorMessage(err))
		});
		return () => {
			this.stopped = true;
			stop();
		};
	}

	of(leadId: string): LastActivity | undefined {
		return this.latest.get(leadId);
	}

	private bump(lead: string) {
		const g = (this.gen.get(lead) ?? 0) + 1;
		this.gen.set(lead, g);
		return g;
	}

	private set(rec: LastActivity) {
		const cur = this.latest.get(rec.lead);
		if (
			cur &&
			cur.id === rec.id &&
			cur.occurred_at === rec.occurred_at &&
			cur.type === rec.type &&
			cur.subject === rec.subject &&
			cur.body === rec.body
		)
			return; // unchanged: keep the object, no re-render of the card
		this.latest.set(rec.lead, {
			id: rec.id,
			lead: rec.lead,
			type: rec.type,
			subject: rec.subject ?? '',
			occurred_at: rec.occurred_at,
			created: rec.created,
			body: rec.body ?? ''
		});
	}

	private onEvent(action: string, rec: LastActivity) {
		// the activity may have been the latest of another lead (its lead changed by API)
		for (const [lead, cur] of this.latest) {
			if (cur.id === rec.id && lead !== rec.lead) {
				this.latest.delete(lead);
				this.reread(lead);
			}
		}
		this.bump(rec.lead);
		const cur = this.latest.get(rec.lead);
		if (action === 'delete') {
			if (cur?.id === rec.id) {
				this.latest.delete(rec.lead);
				this.reread(rec.lead);
			}
			return;
		}
		if (!cur || isNewer(rec, cur)) this.set(rec);
		else if (cur.id === rec.id) {
			// edited: still the latest unless it moved back in time behind another one
			if (rec.occurred_at === cur.occurred_at) this.set(rec);
			else {
				this.set(rec);
				this.reread(rec.lead);
			}
		}
	}

	/** reads the latest activity of one lead from the view; again if an event overtook it */
	private async reread(lead: string, attempts = 3) {
		const g = this.bump(lead);
		try {
			const res = await pb.collection('lead_last_activity').getList<LastActivity>(1, 1, {
				filter: pb.filter('lead = {:id}', { id: lead }),
				fields: LAST_ACTIVITY_FIELDS
			});
			if (this.stopped) return;
			if (this.gen.get(lead) !== g) {
				if (attempts > 1) this.reread(lead, attempts - 1);
				return;
			}
			const row = res.items[0];
			if (row) this.set(row);
			else this.latest.delete(lead);
		} catch (err) {
			if (!this.stopped) this.error = errorMessage(err);
		}
	}

	/** (re)load: entries only change where the latest activity differs */
	private replace(list: LastActivity[]) {
		const seen = new Set<string>();
		for (const row of list) {
			seen.add(row.lead);
			this.set(row);
		}
		for (const lead of [...this.latest.keys()]) if (!seen.has(lead)) this.latest.delete(lead);
	}
}
