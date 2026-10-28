import { ClientResponseError, type RecordModel } from 'pocketbase';
import { auth } from './auth.svelte';
import { liveSync } from './live';
import { pb } from './pb';
import type { Company, Contact, User } from './types';
import { contactName } from './types';

/**
 * A whole collection kept in memory and live (companies, contacts: a few hundred to
 * thousands of small records). Lists, pickers and lead cards all read from here, so
 * there is no `expand` to forget and a rename shows up everywhere at once.
 *
 * Ref-counted: components call `use()` from a `$effect` and return its result; realtime
 * runs while at least one component needs the data.
 */
export class LiveCollection<T extends RecordModel> {
	list = $state<T[]>([]);
	loaded = $state(false);
	error = $state('');
	private byId = $derived(new Map(this.list.map((r) => [r.id, r])));
	private refs = 0;
	private stop: (() => void) | null = null;

	constructor(
		readonly name: string,
		private readonly compare: (a: T, b: T) => number
	) {}

	use(): () => void {
		if (this.refs++ === 0) {
			this.stop = liveSync({
				subscribe: (handle) => [
					pb.collection(this.name).subscribe<T>('*', (e) =>
						handle(() => {
							this.remove(e.record.id);
							if (e.action !== 'delete') this.insert(e.record);
						})
					)
				],
				fetch: () => pb.collection(this.name).getFullList<T>(),
				apply: (list) => {
					this.list = list.sort(this.compare);
					this.error = '';
				},
				onError: (err) => (this.error = err instanceof Error ? err.message : String(err)),
				onSettled: () => (this.loaded = true)
			});
		}
		return () => {
			if (--this.refs === 0) {
				this.stop?.();
				this.stop = null;
			}
		};
	}

	get(id: string): T | undefined {
		return this.byId.get(id);
	}

	private remove(id: string) {
		const i = this.list.findIndex((r) => r.id === id);
		if (i !== -1) this.list.splice(i, 1);
	}

	private insert(rec: T) {
		const i = this.list.findIndex((r) => this.compare(r, rec) > 0);
		this.list.splice(i === -1 ? this.list.length : i, 0, rec);
	}

	/**
	 * A failed write may mean our session became invalid (PocketBase then answers as for a
	 * guest: 400/403/404): check it, so the user is sent to the login instead of seeing a
	 * confusing error. The original error is rethrown either way.
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

	async create(data: Partial<T>): Promise<T> {
		const rec = await this.guard(() => pb.collection(this.name).create<T>(data));
		// dedupe against the realtime create event
		if (!this.get(rec.id)) this.insert(rec);
		return rec;
	}

	async update(id: string, data: Partial<T>): Promise<T> {
		const rec = await this.guard(() => pb.collection(this.name).update<T>(id, data));
		// a newer save by someone else may already have arrived by realtime; keep that
		// (PocketBase date strings compare correctly as strings)
		const cur = this.get(id);
		if (cur && cur.updated > rec.updated) return rec;
		this.remove(id);
		// deleted by someone else in the meantime: don't resurrect it
		if (cur) this.insert(rec);
		return rec;
	}

	async delete(id: string) {
		await this.guard(() => pb.collection(this.name).delete(id));
		this.remove(id);
	}
}

const de = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' });

export const companies = new LiveCollection<Company>('companies', (a, b) => de(a.name, b.name));

export const contacts = new LiveCollection<Contact>(
	'contacts',
	(a, b) => de(a.last_name, b.last_name) || de(a.first_name, b.first_name)
);

// users only change in the PocketBase dashboard, but live keeps renames and new
// accounts visible without a reload (and never caches an empty answer for good)
export const users = new LiveCollection<User>('users', (a, b) =>
	de(a.name || a.email, b.name || b.email)
);

export function userLabel(id: string) {
	const u = users.get(id);
	return u ? u.name || u.email || 'Unbenannt' : '';
}

export function companyName(id: string) {
	return companies.get(id)?.name ?? '';
}

export function contactLabel(id: string) {
	const c = contacts.get(id);
	return c ? contactName(c) : '';
}
