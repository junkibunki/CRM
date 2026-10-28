import { ClientResponseError, type RecordSubscription } from 'pocketbase';
import { auth } from './auth.svelte';
import { liveSync } from './live';
import { errorMessage, pb } from './pb';
import { freshRanks, insertSorted, rankBetween } from './rank';
import { type Board, type BoardColumn, type Lead, type LeadData } from './types';

// Keys grow by about a character every few inserts at the same spot; well below the
// schema's max of 100, re-rank the list instead of letting the save fail.
const MAX_RANK_LENGTH = 50;

/**
 * The record no longer exists (deleted by someone else). A 404 can also mean our session
 * became invalid (PocketBase then answers as for a guest), so the session is checked
 * first; if it is invalid, auth.refresh() logs out and this is not treated as "gone".
 */
async function isGone(err: unknown) {
	if (!(err instanceof ClientResponseError && err.status === 404)) return false;
	return auth.refresh();
}

/**
 * State of one board. Columns and each column's leads are kept sorted by rank and only
 * ever mutated in place (splice/insert), so a move re-renders just the two columns
 * involved and concurrent changes from other users don't overwrite each other.
 */
export class BoardStore {
	board = $state<Board | null>(null);
	columns = $state<BoardColumn[]>([]);
	leads = $state<Record<string, Lead[]>>({});
	loading = $state(true);
	deleted = $state(false);
	error = $state('');

	constructor(readonly id: string) {}

	/** Starts realtime + initial load; returns the teardown. Call from a component's $effect. */
	sync(): () => void {
		const byBoard = { filter: pb.filter('board = {:id}', { id: this.id }) };
		const byLeadBoard = { filter: pb.filter('column.board = {:id}', { id: this.id }) };
		return liveSync({
			subscribe: (handle) => [
				pb.collection('boards').subscribe<Board>(this.id, (e) => handle(() => this.onBoard(e))),
				pb
					.collection('board_columns')
					.subscribe<BoardColumn>('*', (e) => handle(() => this.onColumn(e)), byBoard),
				pb.collection('leads').subscribe<Lead>('*', (e) => handle(() => this.onLead(e)), byLeadBoard)
			],
			fetch: () =>
				Promise.all([
					pb.collection('boards').getOne<Board>(this.id),
					pb.collection('board_columns').getFullList<BoardColumn>({ ...byBoard, sort: 'rank,id' }),
					pb.collection('leads').getFullList<Lead>({ ...byLeadBoard, sort: 'rank,id' })
				]),
			apply: ([board, columns, leads], first) => {
				if (first) this.replace(board, columns, leads);
				else {
					this.reconcile(board, columns, leads);
					this.error = ''; // e.g. a load error from while we were offline
				}
			},
			onError: async (err) => {
				if (await isGone(err)) this.deleted = true;
				else this.error = errorMessage(err);
			},
			onSettled: () => (this.loading = false)
		});
	}

	private replace(board: Board, columns: BoardColumn[], leads: Lead[]) {
		const grouped: Record<string, Lead[]> = {};
		for (const col of columns) grouped[col.id] = [];
		for (const lead of leads) grouped[lead.column]?.push(lead);
		this.board = board;
		this.columns = columns;
		this.leads = grouped;
	}

	/**
	 * Reload after a reconnect: merge into the existing records instead of replacing them,
	 * so unchanged leads keep their objects (no re-render, no DnD re-registration, a drag
	 * in progress survives).
	 */
	private reconcile(board: Board, columns: BoardColumn[], leads: Lead[]) {
		if (this.board) Object.assign(this.board, board);
		else this.board = board;

		const colIds = new Set(columns.map((c) => c.id));
		for (const c of this.columns.filter((c) => !colIds.has(c.id))) this.removeColumn(c.id);
		for (const c of columns) this.onColumn({ action: 'update', record: c });

		const local = new Map<string, Lead>();
		for (const list of Object.values(this.leads)) for (const c of list) local.set(c.id, c);
		const cardIds = new Set(leads.map((c) => c.id));
		for (const id of local.keys()) if (!cardIds.has(id)) this.removeLead(id);
		for (const c of leads) {
			const cur = local.get(c.id);
			if (cur && cur.updated === c.updated) continue; // unchanged
			this.onLead({ action: 'update', record: c });
		}
	}

	// --- realtime -------------------------------------------------------------------

	private onBoard(e: RecordSubscription<Board>) {
		if (e.action === 'delete') this.deleted = true;
		else if (this.board) Object.assign(this.board, e.record);
	}

	private onColumn(e: RecordSubscription<BoardColumn>) {
		const rec = e.record;
		const i = this.columns.findIndex((c) => c.id === rec.id);
		if (e.action === 'delete') {
			if (i !== -1) this.columns.splice(i, 1);
			delete this.leads[rec.id];
			return;
		}
		this.leads[rec.id] ??= [];
		if (i !== -1) {
			const cur = this.columns[i];
			const moved = cur.rank !== rec.rank;
			Object.assign(cur, rec);
			if (!moved) return;
			this.columns.splice(i, 1);
			insertSorted(this.columns, cur);
			return;
		}
		insertSorted(this.columns, rec);
	}

	private onLead(e: RecordSubscription<Lead>) {
		const rec = e.record;
		const loc = this.findLead(rec.id);
		if (e.action === 'delete') {
			if (loc) this.leads[loc.column].splice(loc.index, 1);
			return;
		}
		if (loc) {
			const cur = this.leads[loc.column][loc.index];
			// compare against the list the lead sits in, not its fields: those may have been
			// set locally (optimistic move) without the list having caught up
			const moved = loc.column !== rec.column || cur.rank !== rec.rank;
			Object.assign(cur, rec);
			if (!moved) return;
			this.leads[loc.column].splice(loc.index, 1);
			const target = this.leads[cur.column];
			if (target) insertSorted(target, cur);
			return;
		}
		// create (or an update for a lead we didn't have yet); dedupes our own creates
		const target = this.leads[rec.column];
		if (target) insertSorted(target, rec);
	}

	// --- helpers --------------------------------------------------------------------

	findLead(id: string): { column: string; index: number } | null {
		for (const [column, list] of Object.entries(this.leads)) {
			const index = list.findIndex((c) => c.id === id);
			if (index !== -1) return { column, index };
		}
		return null;
	}

	private removeLead(id: string) {
		const loc = this.findLead(id);
		if (loc) this.leads[loc.column].splice(loc.index, 1);
	}

	private removeColumn(id: string) {
		const i = this.columns.findIndex((c) => c.id === id);
		if (i !== -1) this.columns.splice(i, 1);
		delete this.leads[id];
	}

	private fail(err: unknown) {
		this.error = errorMessage(err);
	}

	/** Rank for position `index` in `list` (which must not contain the moved item). */
	private async rankAt<T extends { id: string; rank: string }>(
		list: T[],
		index: number,
		collection: 'leads' | 'board_columns'
	): Promise<string> {
		const between = () => rankBetween(list[index - 1]?.rank ?? null, list[index]?.rank ?? null);
		const rank = between();
		if (rank !== null && rank.length <= MAX_RANK_LENGTH) return rank;
		// colliding neighbours or keys grown too long: give the whole list fresh keys
		const keys = freshRanks(list.length);
		await Promise.all(
			list.map((item, i) => {
				item.rank = keys[i];
				return pb.collection(collection).update(item.id, { rank: keys[i] });
			})
		);
		return between()!;
	}

	clearError() {
		this.error = '';
	}

	// --- board ----------------------------------------------------------------------

	async updateBoard(data: Partial<Pick<Board, 'name' | 'card_fields'>>) {
		if (!this.board) return;
		const prev = { name: this.board.name, card_fields: this.board.card_fields };
		Object.assign(this.board, data);
		try {
			await pb.collection('boards').update(this.id, data);
		} catch (err) {
			if (await isGone(err)) {
				this.deleted = true;
				return;
			}
			Object.assign(this.board, prev);
			this.fail(err);
		}
	}

	// --- columns --------------------------------------------------------------------

	async addColumn(data: Pick<BoardColumn, 'name' | 'color' | 'wip_limit'>) {
		try {
			const rank = await this.rankAt(this.columns, this.columns.length, 'board_columns');
			const rec = await pb
				.collection('board_columns')
				.create<BoardColumn>({ ...data, board: this.id, rank });
			this.leads[rec.id] ??= [];
			if (!this.columns.some((c) => c.id === rec.id)) insertSorted(this.columns, rec);
		} catch (err) {
			this.fail(err);
		}
	}

	async updateColumn(id: string, data: Partial<Pick<BoardColumn, 'name' | 'color' | 'wip_limit'>>) {
		const col = this.columns.find((c) => c.id === id);
		if (!col) return;
		const prev = { name: col.name, color: col.color, wip_limit: col.wip_limit };
		Object.assign(col, data);
		try {
			await pb.collection('board_columns').update(id, data);
		} catch (err) {
			if (await isGone(err)) return this.removeColumn(id);
			Object.assign(col, prev);
			this.fail(err);
		}
	}

	/** Deletes the column and (cascade) all its leads. */
	async deleteColumn(id: string) {
		try {
			await pb.collection('board_columns').delete(id);
			this.removeColumn(id);
		} catch (err) {
			if (await isGone(err)) this.removeColumn(id);
			else this.fail(err);
		}
	}

	/** Moves a column to `toIndex`, counted in the list without the column itself. */
	async moveColumn(id: string, toIndex: number) {
		const col = this.columns.find((c) => c.id === id);
		if (!col) return;
		const prevRank = col.rank;
		let rank: string;
		try {
			rank = await this.rankAt(
				this.columns.filter((c) => c.id !== id),
				toIndex,
				'board_columns'
			);
		} catch (err) {
			return this.fail(err);
		}
		// it may have been deleted during the (unlikely) re-rank await
		const i = this.columns.indexOf(col);
		if (i === -1) return;
		this.columns.splice(i, 1);
		col.rank = rank;
		insertSorted(this.columns, col);
		try {
			await pb.collection('board_columns').update(id, { rank });
		} catch (err) {
			if (await isGone(err)) return this.removeColumn(id);
			// roll back only if nobody else has moved it in the meantime
			const j = this.columns.indexOf(col);
			if (j !== -1 && col.rank === rank) {
				this.columns.splice(j, 1);
				col.rank = prevRank;
				insertSorted(this.columns, col);
			}
			this.fail(err);
		}
	}

	// --- leads ----------------------------------------------------------------------

	/** Creates a lead at the end of a stage; resolves false if saving failed (error is set). */
	async addLead(columnId: string, data: LeadData): Promise<boolean> {
		const list = this.leads[columnId];
		if (!list) {
			this.error = 'Diese Phase gibt es nicht mehr (inzwischen gelöscht).';
			return false;
		}
		try {
			const rank = await this.rankAt(list, list.length, 'leads');
			const rec = await pb.collection('leads').create<Lead>({ ...data, column: columnId, rank });
			if (!this.findLead(rec.id)) insertSorted(this.leads[columnId] ?? [], rec);
			return true;
		} catch (err) {
			this.fail(err);
			return false;
		}
	}

	async updateLead(id: string, data: Partial<LeadData>) {
		const loc = this.findLead(id);
		if (!loc) {
			this.error = 'Der Lead wurde inzwischen gelöscht, die Änderungen sind nicht gespeichert.';
			return;
		}
		const lead = this.leads[loc.column][loc.index];
		const prev = Object.fromEntries(Object.keys(data).map((k) => [k, lead[k]]));
		Object.assign(lead, data);
		try {
			// the response is deliberately not applied: the optimistic state already holds our
			// values, and a newer edit by someone else may have arrived by realtime before it.
			// The realtime event for our own update brings `updated` etc.
			await pb.collection('leads').update(id, data);
		} catch (err) {
			if (await isGone(err)) {
				this.removeLead(id);
				this.error = 'Der Lead wurde inzwischen gelöscht, die Änderungen sind nicht gespeichert.';
				return;
			}
			Object.assign(lead, prev);
			this.fail(err);
		}
	}

	async deleteLead(id: string) {
		const loc = this.findLead(id);
		if (!loc) return;
		const [lead] = this.leads[loc.column].splice(loc.index, 1);
		try {
			await pb.collection('leads').delete(id);
		} catch (err) {
			if (await isGone(err)) return; // already deleted by someone else
			if (!this.findLead(id)) insertSorted(this.leads[lead.column] ?? [], lead);
			this.fail(err);
		}
	}

	/** Moves a lead into `toColumn` at `toIndex`, counted in that column without the lead itself. */
	async moveLead(id: string, toColumn: string, toIndex: number) {
		const loc = this.findLead(id);
		const target = this.leads[toColumn];
		if (!loc || !target) return;
		const lead = this.leads[loc.column][loc.index];
		const prev = { column: lead.column, rank: lead.rank };
		let rank: string;
		try {
			rank = await this.rankAt(
				target.filter((c) => c.id !== id),
				toIndex,
				'leads'
			);
		} catch (err) {
			return this.fail(err);
		}
		// the lists may have changed during an (unlikely) re-rank await
		const now = this.findLead(id);
		const dest = this.leads[toColumn];
		if (!now || !dest) return;
		this.leads[now.column].splice(now.index, 1);
		lead.column = toColumn;
		lead.rank = rank;
		insertSorted(dest, lead);
		try {
			await pb.collection('leads').update(id, { column: toColumn, rank });
		} catch (err) {
			if (await isGone(err)) return this.removeLead(id);
			// roll back only if nobody else has moved it in the meantime
			const cur = this.findLead(id);
			const back = this.leads[prev.column];
			if (cur && back && lead.column === toColumn && lead.rank === rank) {
				this.leads[cur.column].splice(cur.index, 1);
				lead.column = prev.column;
				lead.rank = prev.rank;
				insertSorted(back, lead);
			}
			this.fail(err);
		}
	}
}
