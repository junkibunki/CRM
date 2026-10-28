import { ClientResponseError, type RecordSubscription } from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { auth } from '../auth.svelte';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import { byRank, insertSorted } from '../rank';
import type { BoardColumn } from '../types';
import { planRequirements } from './editor';
import { applicable, fulfilled, normalizeValue, openOf } from './evaluate';
import type {
	CheckEntry,
	CheckEvent,
	LeadCheck,
	RequirementDraft,
	StageRequirement
} from './types';

type Columns = readonly Pick<BoardColumn, 'id' | 'board' | 'rank' | 'gates_exempt'>[];
type Scope = {
	/** filter for stage_requirements ('' = all) */
	requirements: string;
	/** filter for lead_checks */
	checks: string;
	/** filter for lead_check_events; null = don't load the log */
	events: string | null;
};

const CHECK_FIELDS = 'id,lead,requirement,value,by,created,updated';

/**
 * A failed write may mean our session became invalid (PocketBase answers a guest with
 * 400/403/404): check it, so the user gets the login instead of a puzzling error.
 */
async function checkSession(err: unknown) {
	if (err instanceof ClientResponseError && [400, 403, 404].includes(err.status)) await auth.refresh();
}

/**
 * Stage requirements and the checks of leads (F12), live. ONE query for the requirements and
 * ONE for the checks (plus one for the log on the lead page), never one per card.
 * - `forBoard`: the pipeline (cards, gate dialog when moving, lock icon on stages);
 * - `forLead`: the lead page (tile with status, change, revoke and the log).
 * `checks` maps lead id -> requirement id -> check; it is a SvelteMap and every entry is
 * replaced (not mutated) on change, so only the card of that lead re-renders.
 */
export class GateStore {
	/** all requirements in scope, sorted by rank (then id) */
	requirements = $state<StageRequirement[]>([]);
	readonly checks = new SvelteMap<string, Readonly<Record<string, LeadCheck>>>();
	/** log of the lead (only `forLead`), newest first */
	events = $state<CheckEvent[]>([]);
	loaded = $state(false);
	error = $state('');

	/** stage id -> its requirements in order */
	readonly byColumn = $derived.by(() => {
		const map = new Map<string, StageRequirement[]>();
		for (const r of this.requirements) {
			const list = map.get(r.column);
			if (list) list.push(r);
			else map.set(r.column, [r]);
		}
		return map;
	});

	private constructor(private readonly scope: Scope) {}

	static forBoard(boardId: string) {
		return new GateStore({
			requirements: pb.filter('column.board = {:id}', { id: boardId }),
			checks: pb.filter('lead.column.board = {:id}', { id: boardId }),
			events: null
		});
	}

	static forLead(leadId: string) {
		return new GateStore({
			requirements: '',
			checks: pb.filter('lead = {:id}', { id: leadId }),
			events: pb.filter('lead = {:id}', { id: leadId })
		});
	}

	/** Starts realtime + initial load; returns the teardown. Call from a component's $effect. */
	sync(): () => void {
		const { scope } = this;
		const reqOpts = scope.requirements ? { filter: scope.requirements } : {};
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('stage_requirements')
					.subscribe<StageRequirement>('*', (e) => handle(() => this.onRequirement(e)), reqOpts),
				pb.collection('lead_checks').subscribe<LeadCheck>('*', (e) => handle(() => this.onCheck(e)), {
					filter: scope.checks,
					fields: CHECK_FIELDS
				}),
				...(scope.events === null
					? []
					: [
							pb
								.collection('lead_check_events')
								.subscribe<CheckEvent>('*', (e) => handle(() => this.onEvent(e)), {
									filter: scope.events
								})
						])
			],
			fetch: () =>
				Promise.all([
					pb.collection('stage_requirements').getFullList<StageRequirement>({ ...reqOpts, sort: 'rank,id' }),
					pb.collection('lead_checks').getFullList<LeadCheck>({ filter: scope.checks, fields: CHECK_FIELDS }),
					scope.events === null
						? Promise.resolve([] as CheckEvent[])
						: pb
								.collection('lead_check_events')
								.getFullList<CheckEvent>({ filter: scope.events, sort: '-created,-id' })
				]),
			apply: ([requirements, checks, events]) => {
				this.requirements = requirements.sort(byRank);
				this.replaceChecks(checks);
				this.events = events;
				this.error = '';
				this.loaded = true;
			},
			onError: (err) => (this.error = errorMessage(err))
		});
	}

	clearError() {
		this.error = '';
	}

	// --- reading --------------------------------------------------------------------

	/** requirements that apply to `columnId` (its stage and every earlier one) */
	applicableFor(columnId: string, columns: Columns): StageRequirement[] {
		return applicable(this.requirements, columns, columnId);
	}

	/** check of a lead for a requirement */
	checkOf(leadId: string, requirementId: string): LeadCheck | undefined {
		return this.checks.get(leadId)?.[requirementId];
	}

	/** of `list`, those the lead has not fulfilled (reads only this lead's entry) */
	openOf(list: readonly StageRequirement[], leadId: string): StageRequirement[] {
		return list.length ? openOf(list, this.checks.get(leadId)) : [];
	}

	/** requirements of `columnId` (cumulative) the lead has not fulfilled */
	openFor(leadId: string, columnId: string, columns: Columns): StageRequirement[] {
		return this.openOf(this.applicableFor(columnId, columns), leadId);
	}

	// --- realtime -------------------------------------------------------------------

	private onRequirement(e: RecordSubscription<StageRequirement>) {
		const rec = e.record;
		const i = this.requirements.findIndex((r) => r.id === rec.id);
		if (e.action === 'delete') {
			if (i !== -1) this.requirements.splice(i, 1);
			return;
		}
		if (i === -1) return insertSorted(this.requirements, rec);
		const cur = this.requirements[i];
		// our save's answer may arrive after a newer realtime event of someone else
		if (cur.updated && rec.updated && cur.updated > rec.updated) return;
		const moved = cur.rank !== rec.rank;
		Object.assign(cur, rec);
		if (!moved) return;
		this.requirements.splice(i, 1);
		insertSorted(this.requirements, cur);
	}

	private onCheck(e: RecordSubscription<LeadCheck>) {
		if (e.action === 'delete') this.dropCheck(e.record);
		else this.putCheck(e.record);
	}

	private onEvent(e: RecordSubscription<CheckEvent>) {
		if (e.action !== 'create') return; // the log is never changed
		if (this.events.some((x) => x.id === e.record.id)) return;
		// newest first; realtime delivers in order, a create is (almost always) the newest
		const i = this.events.findIndex((x) => x.created < e.record.created);
		this.events.splice(i === -1 ? this.events.length : i, 0, e.record);
	}

	private putCheck(c: LeadCheck) {
		const cur = this.checks.get(c.lead)?.[c.requirement];
		// an older answer must not overwrite a newer realtime state (and vice versa)
		if (cur && cur.id === c.id && cur.updated && c.updated && cur.updated > c.updated) return;
		if (cur && cur.id === c.id && cur.updated === c.updated && cur.value === c.value) return;
		const rec: LeadCheck = {
			...c,
			id: c.id,
			lead: c.lead,
			requirement: c.requirement,
			value: c.value ?? '',
			by: c.by ?? ''
		};
		this.checks.set(c.lead, { ...this.checks.get(c.lead), [c.requirement]: rec });
	}

	private dropCheck(c: Pick<LeadCheck, 'id' | 'lead' | 'requirement'>) {
		const entry = this.checks.get(c.lead);
		if (!entry || entry[c.requirement]?.id !== c.id) return;
		const next = { ...entry };
		delete next[c.requirement];
		if (Object.keys(next).length) this.checks.set(c.lead, next);
		else this.checks.delete(c.lead);
	}

	private replaceChecks(list: LeadCheck[]) {
		const grouped = new Map<string, Record<string, LeadCheck>>();
		for (const c of list) {
			const entry = grouped.get(c.lead) ?? {};
			entry[c.requirement] = { ...c, value: c.value ?? '', by: c.by ?? '' };
			grouped.set(c.lead, entry);
		}
		for (const lead of [...this.checks.keys()]) if (!grouped.has(lead)) this.checks.delete(lead);
		for (const [lead, entry] of grouped) {
			const cur = this.checks.get(lead);
			const same =
				cur &&
				Object.keys(cur).length === Object.keys(entry).length &&
				Object.values(entry).every((c) => {
					const o = cur[c.requirement];
					return o && o.id === c.id && o.value === c.value && o.updated === c.updated;
				});
			if (!same) this.checks.set(lead, entry); // unchanged: no re-render of the card
		}
	}

	// --- writes: checks -------------------------------------------------------------

	/**
	 * Saves confirmations of a lead (waits for the server; the move comes after it). An
	 * already fulfilled check with the same value is left alone, an existing one is updated.
	 * Throws on failure (invalid value, server error); checks saved before that stay.
	 */
	async confirm(leadId: string, entries: readonly CheckEntry[]): Promise<void> {
		const me = pb.authStore.record?.id ?? ''; // the rule wants exactly the requesting user
		const reqs = new Map(this.requirements.map((r) => [r.id, r]));
		const writes = entries.map(async (entry) => {
			const req = reqs.get(entry.requirement);
			if (!req) throw new Error('Eine Bedingung wurde inzwischen gelöscht.');
			const n = normalizeValue(req, entry.value);
			if ('error' in n) throw new Error(`${req.label}: ${n.error}`);
			const cur = this.checkOf(leadId, req.id);
			if (cur && fulfilled(req, cur) && cur.value === n.value) return;
			const data = { value: n.value, by: me };
			let rec: LeadCheck;
			if (cur) rec = await pb.collection('lead_checks').update<LeadCheck>(cur.id, data, { fields: CHECK_FIELDS });
			else {
				try {
					rec = await pb
						.collection('lead_checks')
						.create<LeadCheck>({ ...data, lead: leadId, requirement: req.id }, { fields: CHECK_FIELDS });
				} catch (err) {
					// someone else confirmed it at the same moment (unique lead + requirement)
					const other = await this.findCheck(leadId, req.id);
					if (!other) throw err;
					rec = fulfilled(req, other)
						? other
						: await pb.collection('lead_checks').update<LeadCheck>(other.id, data, { fields: CHECK_FIELDS });
				}
			}
			this.putCheck(rec);
		});
		const results = await Promise.allSettled(writes);
		const failed = results.find((r) => r.status === 'rejected');
		if (failed) {
			await checkSession(failed.reason);
			throw failed.reason;
		}
	}

	private async findCheck(leadId: string, requirementId: string): Promise<LeadCheck | null> {
		try {
			return await pb
				.collection('lead_checks')
				.getFirstListItem<LeadCheck>(
					pb.filter('lead = {:lead} && requirement = {:req}', { lead: leadId, req: requirementId }),
					{ fields: CHECK_FIELDS }
				);
		} catch {
			return null;
		}
	}

	/** Takes a confirmation back (deletes the check); throws on failure. */
	async revoke(check: Pick<LeadCheck, 'id' | 'lead' | 'requirement'>): Promise<void> {
		try {
			await pb.collection('lead_checks').delete(check.id);
		} catch (err) {
			// 404 with a valid session: already taken back by someone else, what we wanted
			// (an invalid session also answers 404; refresh() then logs out)
			const gone = err instanceof ClientResponseError && err.status === 404 && (await auth.refresh());
			if (!gone) {
				await checkSession(err);
				throw err;
			}
		}
		this.dropCheck(check);
	}

	// --- writes: requirements (stage dialog) -----------------------------------------

	/**
	 * Turns the requirements of a stage into `draft` (create / update changed fields / delete,
	 * ranks in draft order). `initial` = the stage's requirements when the dialog opened.
	 * Errors go to `error` (the dialog is already closed, like the stage itself).
	 */
	async saveRequirements(
		columnId: string,
		draft: readonly RequirementDraft[],
		initial: readonly StageRequirement[]
	) {
		const plan = planRequirements(initial, draft);
		const col = pb.collection('stage_requirements');
		const results = await Promise.allSettled([
			...plan.create.map(async (data) =>
				this.onRequirement({
					action: 'create',
					record: await col.create<StageRequirement>({ ...data, column: columnId })
				})
			),
			...plan.update.map(async ({ id, data }) =>
				this.onRequirement({ action: 'update', record: await col.update<StageRequirement>(id, data) })
			),
			...plan.remove.map(async (id) => {
				try {
					await col.delete(id);
				} catch (err) {
					if (!(err instanceof ClientResponseError && err.status === 404)) throw err;
				}
				const i = this.requirements.findIndex((r) => r.id === id);
				if (i !== -1) this.requirements.splice(i, 1);
			})
		]);
		const failed = results.find((r) => r.status === 'rejected');
		if (failed) {
			await checkSession(failed.reason);
			this.error = `Bedingungen: ${errorMessage(failed.reason)}`;
		}
	}
}
