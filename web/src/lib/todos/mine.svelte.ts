import { SvelteMap } from 'svelte/reactivity';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import type { Lead } from '../types';
import { doneFields, writeFailure } from './api';
import { OPEN_TODO_FIELDS, type OpenTodo } from './types';

/** What the overview shows of a to-do's lead; `owner` decides whose to-do it is. */
export type LeadInfo = Pick<Lead, 'id' | 'title' | 'owner' | 'company'>;

type TodoRecord = OpenTodo & { done?: boolean; expand?: { lead?: LeadInfo } };

export const LEAD_FIELDS = 'id,title,owner,company';
export const MY_TODO_FIELDS = `${OPEN_TODO_FIELDS},${LEAD_FIELDS.split(',')
	.map((f) => `expand.lead.${f}`)
	.join(',')}`;

const sameTodo = (a: OpenTodo, b: OpenTodo) =>
	a.lead === b.lead &&
	a.title === b.title &&
	a.due === b.due &&
	a.due_has_time === b.due_has_time &&
	a.created === b.created;

const sameLead = (a: LeadInfo, b: LeadInfo) =>
	a.title === b.title && a.owner === b.owner && a.company === b.company;

/**
 * All open to-dos of all leads, live, with the lead's title and owner: the source of the
 * "Meine To-Dos" page AND the counter in the navigation (one query, one subscription).
 * "Mine" and "all users" are client-side filters over the same data (`list(owner)`).
 *
 * - To-dos are subscribed without a `done` filter: realtime checks the filter against the
 *   record after the change, so ticking off would never arrive. Done ones are dropped here.
 * - Leads are subscribed too (few fields): a change of the lead's owner or title sends no
 *   to-do event, but must move the to-dos between "mine" and someone else's.
 *
 * Ref-counted like LiveCollection: components call `use()` from a `$effect` and return its
 * result; when the last one goes (e.g. on logout) the data is dropped.
 */
export class MyTodosStore {
	/** open to-dos by id */
	readonly todos = new SvelteMap<string, OpenTodo>();
	/** leads of (once) loaded to-dos by id, kept current by the lead subscription */
	readonly leads = new SvelteMap<string, LeadInfo>();
	loaded = $state(false);
	error = $state('');

	private refs = 0;
	private stop: (() => void) | null = null;
	/**
	 * Per to-do with a write in flight: bumped by every realtime event and local change
	 * (rollback check). Entries go when the last write of that to-do is done.
	 */
	private versions = new Map<string, number>();
	/** the running write per to-do: an undo waits for the tick-off before it */
	private pending = new Map<string, Promise<unknown>>();

	use(): () => void {
		if (this.refs++ === 0) this.stop = this.sync();
		return () => {
			if (--this.refs === 0) {
				this.stop?.();
				this.stop = null;
				this.todos.clear();
				this.leads.clear();
				this.versions.clear();
				this.pending.clear();
				this.loaded = false;
				this.error = '';
			}
		};
	}

	private sync(): () => void {
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('todos')
					.subscribe<TodoRecord>('*', (e) => handle(() => this.onTodo(e.action, e.record)), {
						expand: 'lead',
						fields: MY_TODO_FIELDS
					}),
				pb
					.collection('leads')
					.subscribe<LeadInfo>('*', (e) => handle(() => this.onLead(e.action, e.record)), {
						fields: LEAD_FIELDS
					})
			],
			fetch: () =>
				pb.collection('todos').getFullList<TodoRecord>({
					filter: 'done = false',
					expand: 'lead',
					fields: MY_TODO_FIELDS,
					sort: 'due,created'
				}),
			apply: (list) => {
				this.replace(list);
				this.error = '';
				this.loaded = true;
			},
			onError: (err) => (this.error = errorMessage(err))
		});
	}

	/** Open to-dos of the leads `owner` is responsible for; all of them for `null`. */
	list(owner: string | null): OpenTodo[] {
		const out: OpenTodo[] = [];
		for (const t of this.todos.values()) {
			if (owner === null || this.leads.get(t.lead)?.owner === owner) out.push(t);
		}
		return out;
	}

	lead(id: string): LeadInfo | undefined {
		return this.leads.get(id);
	}

	clearError() {
		this.error = '';
	}

	// --- state ----------------------------------------------------------------------

	/** Runs `write` after any running write of the same to-do; forgets the version after the last one. */
	private async serial<R>(id: string, write: () => Promise<R>): Promise<R> {
		const before = this.pending.get(id);
		const run = (async () => {
			await before?.catch(() => {});
			return write();
		})();
		this.pending.set(id, run);
		try {
			return await run;
		} finally {
			if (this.pending.get(id) === run) {
				this.pending.delete(id);
				this.versions.delete(id);
			}
		}
	}

	private bump(id: string) {
		const v = (this.versions.get(id) ?? 0) + 1;
		this.versions.set(id, v);
		return v;
	}

	private putLead(l: LeadInfo) {
		const rec: LeadInfo = { id: l.id, title: l.title, owner: l.owner, company: l.company };
		const cur = this.leads.get(l.id);
		if (!cur || !sameLead(cur, rec)) this.leads.set(l.id, rec);
	}

	private put(t: TodoRecord) {
		if (t.expand?.lead) this.putLead(t.expand.lead);
		const rec: OpenTodo = {
			id: t.id,
			lead: t.lead,
			title: t.title,
			due: t.due,
			due_has_time: !!t.due_has_time,
			created: t.created
		};
		const cur = this.todos.get(t.id);
		if (!cur || !sameTodo(cur, rec)) this.todos.set(t.id, rec);
	}

	private onTodo(action: string, rec: TodoRecord) {
		// versions only matter while one of our writes runs (rollback check)
		if (this.pending.has(rec.id)) this.bump(rec.id);
		if (action === 'delete' || rec.done) this.todos.delete(rec.id);
		else this.put(rec);
	}

	private onLead(action: string, rec: LeadInfo) {
		if (action === 'delete') {
			// its to-dos are deleted with it (cascade); don't wait for their events
			this.leads.delete(rec.id);
			for (const t of [...this.todos.values()]) if (t.lead === rec.id) this.todos.delete(t.id);
		} else if (this.leads.has(rec.id)) this.putLead(rec);
		// unknown lead: none of its to-dos is loaded; a later to-do event brings it (expand)
	}

	/** (re)load: unchanged to-dos and leads keep their objects (no re-render) */
	private replace(list: TodoRecord[]) {
		const seen = new Set<string>();
		for (const t of list) {
			if (t.done) continue;
			seen.add(t.id);
			this.put(t);
		}
		for (const id of [...this.todos.keys()]) if (!seen.has(id)) this.todos.delete(id);
	}

	// --- writes ---------------------------------------------------------------------

	/**
	 * Ticks a to-do off, optimistically; on failure it comes back (unless changed meanwhile).
	 * true = saved; false = not there (any more), deleted by someone else, or failed.
	 */
	async complete(id: string): Promise<boolean> {
		const todo = this.todos.get(id);
		if (!todo) return false;
		const version = this.bump(id);
		this.todos.delete(id);
		return this.serial(id, async () => {
			try {
				await pb.collection('todos').update(id, doneFields(true));
				return true;
			} catch (err) {
				if ((await writeFailure(err)) === 'gone') return false; // deleted by someone else
				// a realtime event since then knows better than our old copy
				if (this.versions.get(id) === version) this.todos.set(id, todo);
				this.error = errorMessage(err);
				return false;
			}
		});
	}

	/**
	 * Takes a just ticked-off to-do back (undo), optimistically. Sent only after a running
	 * tick-off of it, so that one's later done = true cannot overtake it.
	 */
	async reopen(todo: OpenTodo) {
		const version = this.bump(todo.id);
		this.todos.set(todo.id, todo);
		await this.serial(todo.id, async () => {
			try {
				await pb.collection('todos').update(todo.id, doneFields(false));
			} catch (err) {
				const gone = (await writeFailure(err)) === 'gone';
				if (this.versions.get(todo.id) === version) this.todos.delete(todo.id);
				if (!gone) this.error = errorMessage(err);
			}
		});
	}

	/** number of to-dos with a version entry (tests: no growth without writes) */
	get trackedVersions() {
		return this.versions.size;
	}
}

export const myTodos = new MyTodosStore();
