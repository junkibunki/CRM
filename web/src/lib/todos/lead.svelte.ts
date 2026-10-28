import { untrack } from 'svelte';
import { same } from '../diff';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import { createTodo, doneFields, writeFailure } from './api';
import { compareTodos } from './due';
import type { NewTodo, SourceActivity, Todo, TodoData } from './types';

/** the note a to-do came from, with only what the list shows ("aus Notiz vom …") */
const SOURCE = {
	expand: 'source_activity',
	fields:
		'*,expand.source_activity.id,expand.source_activity.type,' +
		'expand.source_activity.subject,expand.source_activity.occurred_at'
};

/** fields of a note that "aus Notiz vom …" shows; its realtime events patch the expand */
const SOURCE_FIELDS = 'id,type,subject,occurred_at';

/** Order of the list: open ones first (next to-do on top), then done ones, latest first. */
export function compareLeadTodos(a: Todo, b: Todo): number {
	if (a.done !== b.done) return a.done ? 1 : -1;
	if (a.done && a.done_at !== b.done_at) return a.done_at < b.done_at ? 1 : -1;
	return compareTodos(a, b);
}

export type TodoEdit = Partial<TodoData & Pick<Todo, 'done' | 'done_at'>>;

/**
 * All to-dos (open and done) of ONE lead, live: the to-do tile of the lead page and the hints
 * on its notes. Shared and ref-counted per lead (useLeadTodos), so the tile and every note
 * read one list with one subscription.
 *
 * Edits are optimistic: a failure rolls back only the fields that still hold our value; a
 * 404 means someone else deleted it meanwhile, then it goes.
 */
export class LeadTodoStore {
	/** sorted by compareLeadTodos; only ever mutated by single splices */
	list = $state<Todo[]>([]);
	loaded = $state(false);
	error = $state('');
	readonly open = $derived(this.list.filter((t) => !t.done));
	readonly done = $derived(this.list.filter((t) => t.done));

	/** bumped by every realtime event and local change of a to-do (rollback check) */
	private versions = new Map<string, number>();

	constructor(readonly leadId: string) {}

	sync(): () => void {
		const filter = pb.filter('lead = {:id}', { id: this.leadId });
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('todos')
					.subscribe<Todo>('*', (e) => handle(() => this.onEvent(e.action, e.record)), {
						filter,
						...SOURCE
					}),
				// the notes of this lead: someone edits the date/type of a note a to-do came from
				// -> "aus Notiz vom …" follows without a reload (a todos event doesn't come then)
				pb
					.collection('activities')
					.subscribe<SourceActivity>('*', (e) => handle(() => this.onSource(e.action, e.record)), {
						filter,
						fields: SOURCE_FIELDS
					})
			],
			fetch: () => pb.collection('todos').getFullList<Todo>({ filter, ...SOURCE }),
			apply: (list) => {
				this.reconcile(list);
				this.error = '';
			},
			onError: (err) => (this.error = errorMessage(err)),
			onSettled: () => (this.loaded = true)
		});
	}

	get(id: string): Todo | undefined {
		return this.list.find((t) => t.id === id);
	}

	/** the to-dos made from one note */
	fromActivity(activityId: string): Todo[] {
		return this.list.filter((t) => t.source_activity === activityId);
	}

	clearError() {
		this.error = '';
	}

	// --- state ----------------------------------------------------------------------

	private bump(id: string) {
		const v = (this.versions.get(id) ?? 0) + 1;
		this.versions.set(id, v);
		return v;
	}

	private index(id: string) {
		return this.list.findIndex((t) => t.id === id);
	}

	private insert(rec: Todo) {
		const i = this.list.findIndex((t) => compareLeadTodos(t, rec) > 0);
		this.list.splice(i === -1 ? this.list.length : i, 0, rec);
	}

	/** moves an (already updated) item to its sorted place, if it isn't there */
	private reposition(t: Todo) {
		const i = this.list.indexOf(t);
		if (i === -1) return;
		const prev = this.list[i - 1];
		const next = this.list[i + 1];
		if ((!prev || compareLeadTodos(prev, t) <= 0) && (!next || compareLeadTodos(t, next) <= 0)) return;
		this.list.splice(i, 1);
		this.insert(t);
	}

	private remove(id: string) {
		const i = this.index(id);
		if (i !== -1) this.list.splice(i, 1);
	}

	private onEvent(action: string, rec: Todo) {
		this.bump(rec.id);
		const i = this.index(rec.id);
		if (action === 'delete' || rec.lead !== this.leadId) {
			if (i !== -1) this.list.splice(i, 1);
			return;
		}
		if (i === -1) return this.insert(rec);
		const cur = this.list[i];
		Object.assign(cur, rec);
		if (!rec.expand) delete cur.expand;
		this.reposition(cur);
	}

	/** a note of this lead changed or went: update the expanded source of its to-dos */
	private onSource(action: string, rec: SourceActivity) {
		for (const t of this.list) {
			if (t.source_activity !== rec.id) continue;
			if (action === 'delete') {
				if (t.expand) delete t.expand.source_activity;
			} else {
				const source = { id: rec.id, type: rec.type, subject: rec.subject, occurred_at: rec.occurred_at };
				t.expand = { ...t.expand, source_activity: source };
			}
		}
	}

	/** after a (re)load: unchanged records keep their object (no re-render) */
	private reconcile(fresh: Todo[]) {
		const cur = new Map(this.list.map((t) => [t.id, t]));
		this.list = fresh
			.map((r) => {
				const c = cur.get(r.id);
				return c && c.updated === r.updated ? c : r;
			})
			.sort(compareLeadTodos);
	}

	// --- writes ---------------------------------------------------------------------

	/** Creates a to-do of this lead; waits for the server and throws on failure (form message). */
	async create(data: NewTodo): Promise<Todo> {
		const rec = await createTodo<Todo>(this.leadId, data, SOURCE);
		this.bump(rec.id);
		if (this.index(rec.id) === -1) this.insert(rec); // dedupe against the realtime event
		return rec;
	}

	/** Saves changed fields optimistically (the caller passes only what changed). */
	async update(id: string, data: TodoEdit) {
		const todo = this.get(id);
		if (!todo || !Object.keys(data).length) return;
		const keys = Object.keys(data) as (keyof TodoEdit)[];
		const prev = Object.fromEntries(keys.map((k) => [k, todo[k]])) as TodoEdit;
		Object.assign(todo, data);
		this.reposition(todo);
		this.bump(id);
		try {
			// the response is not applied: the optimistic state holds our values, and a newer
			// edit by someone else may have arrived by realtime first
			await pb.collection('todos').update(id, data);
		} catch (err) {
			if ((await writeFailure(err)) === 'gone') return this.remove(id);
			// only fields that still hold our value (someone else may have changed others)
			for (const k of keys) if (same(todo[k], data[k])) Object.assign(todo, { [k]: prev[k] });
			this.reposition(todo);
			this.error = errorMessage(err);
		}
	}

	/** Ticks off / takes back with one click. */
	toggle(id: string) {
		const todo = this.get(id);
		if (todo) return this.update(id, doneFields(!todo.done));
	}

	/** Deletes optimistically; on failure it comes back (unless changed meanwhile). */
	async delete(id: string) {
		const i = this.index(id);
		if (i === -1) return;
		const [todo] = this.list.splice(i, 1);
		const version = this.bump(id);
		try {
			await pb.collection('todos').delete(id);
		} catch (err) {
			if ((await writeFailure(err)) === 'gone') return;
			if (this.versions.get(id) === version && this.index(id) === -1) this.insert(todo);
			this.error = errorMessage(err);
		}
	}
}

const shared = new Map<string, { store: LeadTodoStore; refs: number; stop: () => void }>();

/**
 * The shared to-do store of a lead; call from a component's $effect and return `release`.
 * Realtime runs while at least one component uses it.
 */
export function useLeadTodos(leadId: string): { store: LeadTodoStore; release: () => void } {
	let entry = shared.get(leadId);
	if (!entry) {
		const store = new LeadTodoStore(leadId);
		const stop = untrack(() => store.sync());
		entry = { store, refs: 0, stop };
		shared.set(leadId, entry);
	}
	entry.refs++;
	const mine = entry;
	let released = false;
	return {
		store: mine.store,
		release: () => {
			if (released) return;
			released = true;
			if (--mine.refs === 0) {
				mine.stop();
				if (shared.get(leadId) === mine) shared.delete(leadId);
			}
		}
	};
}
