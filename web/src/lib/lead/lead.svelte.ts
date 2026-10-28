import { type RecordSubscription } from 'pocketbase';
import type { BoardStore } from '../board.svelte';
import { applyDelta, listDelta } from '../diff';
import { liveSync } from '../live';
import { gateFailure } from '../gates/prompt.svelte';
import {
	checkSession,
	isGone,
	MAX_RANK_LENGTH,
	RankSaveError,
	RealtimeMarks,
	rollback,
	saveRanks
} from '../optimistic';
import { errorMessage, pb } from '../pb';
import { byRank, freshRanks, insertSorted, rankBetween } from '../rank';
import type { BoardColumn, Lead, LeadData } from '../types';

const GONE = 'Der Lead wurde inzwischen gelöscht, die Änderungen sind nicht gespeichert.';

/** What `LeadDialog` calls on its store; the detail page hands it a `LeadStore`. */
export type LeadWriter = Pick<BoardStore, 'error' | 'addLead' | 'updateLead' | 'deleteLead'>;

/**
 * State of a single lead for its detail page, plus the stages of its pipeline (for the
 * stage picker). Realtime and reloads go through liveSync(); the lead object is only ever
 * merged into (Object.assign), so components holding it keep a live reference.
 */
export class LeadStore implements LeadWriter {
	lead = $state<Lead | null>(null);
	/** all stages (every board), sorted by rank; `stages` narrows to the lead's pipeline */
	columns = $state<BoardColumn[]>([]);
	loading = $state(true);
	/** deleted by someone else, or never existed: the page shows a notice */
	deleted = $state(false);
	/** deleted here (header or LeadDialog): the page goes back to the pipeline */
	removed = $state(false);
	error = $state('');
	// plain variable, not $state: it only steers how a delete event is read
	private deleting = false;
	// realtime events of the lead: a failed write checks whether the server's state arrived
	// meanwhile before it rolls back (see optimistic.ts)
	private marks = new RealtimeMarks();

	constructor(readonly id: string) {}

	/** the stage the lead is in */
	get stage(): BoardColumn | undefined {
		const lead = this.lead;
		return lead ? this.columns.find((c) => c.id === lead.column) : undefined;
	}

	/** stages of the lead's pipeline, in board order */
	get stages(): BoardColumn[] {
		const board = this.stage?.board;
		return board ? this.columns.filter((c) => c.board === board) : [];
	}

	/** Starts realtime + initial load; returns the teardown. Call from a component's $effect. */
	sync(): () => void {
		return liveSync({
			subscribe: (handle) => [
				pb.collection('leads').subscribe<Lead>(this.id, (e) => handle(() => this.onLead(e))),
				pb
					.collection('board_columns')
					.subscribe<BoardColumn>('*', (e) => handle(() => this.onColumn(e)))
			],
			fetch: () =>
				Promise.all([
					pb.collection('leads').getOne<Lead>(this.id),
					pb.collection('board_columns').getFullList<BoardColumn>({ sort: 'rank,id' })
				]),
			apply: ([lead, columns]) => {
				this.marks.note(lead.id);
				// merge, so a reload after a reconnect keeps the object (open dialogs hold it)
				if (this.lead) Object.assign(this.lead, lead);
				else this.lead = lead;
				this.columns = columns.sort(byRank);
				this.error = ''; // e.g. a load error from while we were offline
			},
			onError: async (err) => {
				if (await isGone(err)) this.gone();
				else this.error = errorMessage(err);
			},
			onSettled: () => (this.loading = false)
		});
	}

	private gone() {
		if (this.deleting) this.removed = true;
		else this.deleted = true;
	}

	// --- realtime -------------------------------------------------------------------

	private onLead(e: RecordSubscription<Lead>) {
		if (e.record.id !== this.id) return;
		this.marks.note(this.id);
		if (e.action === 'delete') return this.gone();
		if (this.lead) Object.assign(this.lead, e.record);
		else this.lead = e.record;
	}

	private onColumn(e: RecordSubscription<BoardColumn>) {
		const rec = e.record;
		const i = this.columns.findIndex((c) => c.id === rec.id);
		if (e.action === 'delete') {
			if (i !== -1) this.columns.splice(i, 1);
			return;
		}
		if (i === -1) return insertSorted(this.columns, rec);
		const cur = this.columns[i];
		const moved = cur.rank !== rec.rank;
		Object.assign(cur, rec);
		if (!moved) return;
		this.columns.splice(i, 1);
		insertSorted(this.columns, cur);
	}

	clearError() {
		this.error = '';
	}

	// --- writes ---------------------------------------------------------------------

	/** LeadDialog only creates leads from the board; on this page it edits an existing one. */
	async addLead(): Promise<boolean> {
		this.error = 'Neue Leads werden in der Pipeline angelegt.';
		return false;
	}

	/** Optimistic, like the board: the response is not applied (see kanban.md, Store). */
	async updateLead(id: string, data: Partial<LeadData>, initial?: Partial<LeadData>) {
		const lead = this.lead;
		if (id !== this.id || !lead || this.deleted) {
			this.error = GONE;
			return;
		}
		// contacts as a difference (contacts+ / contacts-), like BoardStore.updateLead, so a
		// contact someone else added meanwhile isn't dropped by sending the whole list
		const ours: Partial<LeadData> = { ...data };
		const body: Record<string, unknown> = { ...data };
		if (data.contacts && initial?.contacts) {
			const delta = listDelta(initial.contacts, data.contacts);
			delete body.contacts;
			if (delta.add.length) body['contacts+'] = delta.add;
			if (delta.remove.length) body['contacts-'] = delta.remove;
			if (delta.add.length || delta.remove.length) ours.contacts = applyDelta(lead.contacts, delta);
			else delete ours.contacts; // only the order differed: nothing to save
		}
		if (!Object.keys(body).length) return;
		const prev = Object.fromEntries(Object.keys(ours).map((k) => [k, lead[k]])) as Partial<LeadData>;
		Object.assign(lead, ours);
		const mark = this.marks.mark(id);
		try {
			await pb.collection('leads').update(id, body);
		} catch (err) {
			if (await isGone(err)) {
				this.deleted = true;
				this.error = GONE;
				return;
			}
			// roll back only fields nobody else has changed in the meantime
			rollback(lead as Partial<LeadData>, prev, ours, this.marks.since(id, mark));
			this.error = errorMessage(err);
		}
	}

	/** Waits for the server; on success `removed` is set (the page navigates away). */
	async deleteLead(id: string) {
		if (id !== this.id) return;
		this.deleting = true;
		try {
			await pb.collection('leads').delete(id);
			this.removed = true;
		} catch (err) {
			if (await isGone(err)) {
				this.removed = true; // already deleted by someone else: what we wanted
				return;
			}
			this.deleting = false;
			this.error = errorMessage(err);
		}
	}

	/**
	 * Moves the lead to the end of another stage: one update of `column` + `rank`, the rank
	 * after the last lead currently in the target stage (see kanban.md).
	 */
	async moveToStage(columnId: string) {
		const lead = this.lead;
		if (!lead || this.deleted || !columnId || columnId === lead.column) return;
		if (!this.columns.some((c) => c.id === columnId)) {
			this.error = 'Diese Phase gibt es nicht mehr (inzwischen gelöscht).';
			return;
		}
		const prev = { column: lead.column, rank: lead.rank };
		let rank: string;
		try {
			rank = await this.rankAtEnd(columnId);
		} catch (err) {
			this.error = errorMessage(err);
			return;
		}
		// realtime may have moved it meanwhile (someone else, or a second pick here)
		if (lead.column !== prev.column || lead.rank !== prev.rank) return;
		lead.column = columnId;
		lead.rank = rank;
		const mark = this.marks.mark(this.id);
		try {
			await pb.collection('leads').update(this.id, { column: columnId, rank });
		} catch (err) {
			if (await isGone(err)) {
				this.deleted = true;
				this.error = GONE;
				return;
			}
			// roll back only if nobody else has moved it in the meantime (also to the same place)
			if (lead.column === columnId && lead.rank === rank && !this.marks.since(this.id, mark)) {
				Object.assign(lead, prev);
			}
			// refused by a stage gate (F12): the server's sentence without the field name
			this.error = gateFailure(err);
		}
	}

	/** Rank after the last lead of `columnId` (without this one); re-ranks the stage if needed. */
	private async rankAtEnd(columnId: string): Promise<string> {
		const list = (
			await pb.collection('leads').getFullList<Pick<Lead, 'id' | 'rank' | 'column'>>({
				filter: pb.filter('column = {:column} && id != {:id}', { column: columnId, id: this.id }),
				sort: 'rank,id',
				fields: 'id,rank,column'
			})
		)
			// the filter is the server's job; checked again so a stale answer can't misplace it
			.filter((l) => l.column === columnId && l.id !== this.id)
			.sort(byRank);
		const rank = rankBetween(list.at(-1)?.rank ?? null, null);
		if (rank !== null && rank.length <= MAX_RANK_LENGTH) return rank;
		// invalid or overly long keys: give the whole stage fresh keys (one batch transaction,
		// see optimistic.ts), ours is the last
		const keys = freshRanks(list.length + 1);
		try {
			await saveRanks(
				'leads',
				list.map((l, i) => ({ id: l.id, rank: keys[i] }))
			);
		} catch (err) {
			const cause = err instanceof RankSaveError ? err.error : err;
			await checkSession(cause); // a failed re-rank may be a guest answer
			throw cause;
		}
		return keys[list.length];
	}
}

