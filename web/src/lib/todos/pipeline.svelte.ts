import { SvelteMap } from 'svelte/reactivity';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import { createTodo, doneFields, writeFailure } from './api';
import { pickNext } from './due';
import { OPEN_TODO_FIELDS, type NewTodo, type OpenTodo } from './types';

type OpenRecord = OpenTodo & { done?: boolean };

const sameTodo = (a: OpenTodo | undefined, b: OpenTodo | undefined) =>
	a === b ||
	(!!a &&
		!!b &&
		a.id === b.id &&
		a.title === b.title &&
		a.due === b.due &&
		a.due_has_time === b.due_has_time);

/**
 * The open to-dos of one pipeline, for the cards: ONE query for all of them
 * (`done = false && lead.column.board = {:id}`, few fields), live. `next` maps each lead to
 * its next to-do; it is a SvelteMap, so a change re-renders only the card of that lead.
 *
 * The subscription filters by board only, not by `done`: realtime checks the filter against
 * the record after the change, so a to-do that was just ticked off would never arrive.
 */
export class PipelineTodoStore {
	/** lead id -> its next open to-do (only leads that have one) */
	readonly next = new SvelteMap<string, OpenTodo>();
	/** first load done (before that, cards show nothing instead of "Kein nächster Schritt") */
	loaded = $state(false);
	error = $state('');

	// plain maps, not $state: only `next` is shown
	private byLead = new Map<string, Map<string, OpenTodo>>();
	private leadOf = new Map<string, string>();
	/** bumped by every realtime event and local change of a to-do (rollback check) */
	private versions = new Map<string, number>();

	constructor(readonly boardId: string) {}

	/** Starts realtime + initial load; returns the teardown. Call from a component's $effect. */
	sync(): () => void {
		const board = pb.filter('lead.column.board = {:id}', { id: this.boardId });
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('todos')
					.subscribe<OpenRecord>('*', (e) => handle(() => this.onEvent(e.action, e.record)), {
						filter: board,
						fields: OPEN_TODO_FIELDS
					})
			],
			fetch: () =>
				pb.collection('todos').getFullList<OpenRecord>({
					filter: pb.filter('done = false && lead.column.board = {:id}', { id: this.boardId }),
					fields: OPEN_TODO_FIELDS,
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

	nextFor(leadId: string): OpenTodo | undefined {
		return this.next.get(leadId);
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

	/** recomputes the next to-do of one lead; only sets the map if it really changed */
	private refresh(lead: string) {
		const best = pickNext(this.byLead.get(lead)?.values() ?? []);
		if (!best) {
			if (this.next.has(lead)) this.next.delete(lead);
		} else if (!sameTodo(this.next.get(lead), best)) this.next.set(lead, best);
	}

	private drop(id: string) {
		const lead = this.leadOf.get(id);
		if (lead === undefined) return;
		this.leadOf.delete(id);
		const todos = this.byLead.get(lead);
		todos?.delete(id);
		if (todos?.size === 0) this.byLead.delete(lead);
		this.refresh(lead);
	}

	private put(t: OpenTodo) {
		const old = this.leadOf.get(t.id);
		if (old !== undefined && old !== t.lead) this.drop(t.id);
		const rec: OpenTodo = {
			id: t.id,
			lead: t.lead,
			title: t.title,
			due: t.due,
			due_has_time: !!t.due_has_time,
			created: t.created
		};
		this.leadOf.set(t.id, t.lead);
		let todos = this.byLead.get(t.lead);
		if (!todos) this.byLead.set(t.lead, (todos = new Map()));
		todos.set(t.id, rec);
		this.refresh(t.lead);
	}

	private onEvent(action: string, rec: OpenRecord) {
		this.bump(rec.id);
		if (action === 'delete' || rec.done) this.drop(rec.id);
		else this.put(rec);
	}

	/** (re)load: rebuild the maps; `next` only changes where the next to-do differs */
	private replace(list: OpenRecord[]) {
		const before = new Set(this.byLead.keys());
		this.byLead.clear();
		this.leadOf.clear();
		for (const t of list) {
			if (t.done) continue;
			let todos = this.byLead.get(t.lead);
			if (!todos) this.byLead.set(t.lead, (todos = new Map()));
			todos.set(t.id, { ...t, due_has_time: !!t.due_has_time });
			this.leadOf.set(t.id, t.lead);
		}
		for (const lead of new Set([...before, ...this.byLead.keys(), ...this.next.keys()])) {
			this.refresh(lead);
		}
	}

	// --- writes ---------------------------------------------------------------------

	/** Creates a to-do (waits for the server, for the form's error message); throws on failure. */
	async create(leadId: string, data: NewTodo): Promise<OpenTodo> {
		const rec = await createTodo<OpenRecord>(leadId, data, { fields: OPEN_TODO_FIELDS });
		// dedupe against the realtime create event (which may have come first)
		if (!this.leadOf.has(rec.id)) this.put(rec);
		return rec;
	}

	/** Ticks a to-do off, optimistically; on failure it comes back (unless changed meanwhile). */
	async complete(id: string) {
		const lead = this.leadOf.get(id);
		const todo = lead === undefined ? undefined : this.byLead.get(lead)?.get(id);
		if (!todo) return;
		const version = this.bump(id);
		this.drop(id);
		try {
			await pb.collection('todos').update(id, doneFields(true));
		} catch (err) {
			if ((await writeFailure(err)) === 'gone') return; // deleted by someone else
			// a realtime event since then knows better than our old copy
			if (this.versions.get(id) === version) this.put(todo);
			this.error = errorMessage(err);
		}
	}
}
