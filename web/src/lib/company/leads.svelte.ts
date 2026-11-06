import { SvelteMap } from 'svelte/reactivity';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import {
	LEAD_FIELDS,
	STAGE_FIELDS,
	activeLeadCounts,
	leadsOfCompany,
	type CompanyLead,
	type Stage
} from './leads';

const sameLead = (a: CompanyLead, b: CompanyLead) =>
	a.title === b.title &&
	a.company === b.company &&
	a.column === b.column &&
	a.owner === b.owner &&
	a.expected_close === b.expected_close &&
	a.created === b.created;

const sameStage = (a: Stage, b: Stage) =>
	a.board === b.board &&
	a.name === b.name &&
	a.color === b.color &&
	!!a.closed === !!b.closed &&
	a.rank === b.rank;

/**
 * All leads of all pipelines (few fields) and all stages, live: the active-lead count on
 * the company list and the lead list on a company's page.
 *
 * Ref-counted like LiveCollection: components call `use()` from a `$effect` and return its
 * result; when the last one goes (e.g. on logout) the data is dropped.
 */
export class CompanyLeadsStore {
	readonly leads = new SvelteMap<string, CompanyLead>();
	readonly stages = new SvelteMap<string, Stage>();
	loaded = $state(false);
	error = $state('');

	private refs = 0;
	private stop: (() => void) | null = null;

	readonly stageOf = (id: string) => this.stages.get(id);

	/** active leads per company id */
	readonly activeCounts = $derived(activeLeadCounts(this.leads.values(), this.stageOf));

	use(): () => void {
		if (this.refs++ === 0) this.stop = this.sync();
		return () => {
			if (--this.refs === 0) {
				// data stays (like LiveCollection): going from the list to a company page tears
				// the old page down before the new one subscribes; without it the counts flicker.
				// The next use() reloads and replaces it.
				this.stop?.();
				this.stop = null;
			}
		};
	}

	/** A company's leads, active and closed ones apart, newest first. */
	ofCompany(companyId: string) {
		return leadsOfCompany(this.leads.values(), companyId, this.stageOf);
	}

	private sync(): () => void {
		return liveSync({
			subscribe: (handle) => [
				pb
					.collection('leads')
					.subscribe<CompanyLead>('*', (e) => handle(() => this.onLead(e.action, e.record)), {
						fields: LEAD_FIELDS
					}),
				pb
					.collection('board_columns')
					.subscribe<Stage>('*', (e) => handle(() => this.onStage(e.action, e.record)), {
						fields: STAGE_FIELDS
					})
			],
			fetch: () =>
				Promise.all([
					pb.collection('leads').getFullList<CompanyLead>({ fields: LEAD_FIELDS }),
					pb.collection('board_columns').getFullList<Stage>({ fields: STAGE_FIELDS })
				]),
			apply: ([leads, stages]) => {
				replace(this.leads, leads.map(pickLead), sameLead);
				replace(this.stages, stages.map(pickStage), sameStage);
				this.error = '';
			},
			onError: (err) => (this.error = errorMessage(err)),
			onSettled: () => (this.loaded = true)
		});
	}

	private onLead(action: string, rec: CompanyLead) {
		if (action === 'delete') this.leads.delete(rec.id);
		else put(this.leads, pickLead(rec), sameLead);
	}

	private onStage(action: string, rec: Stage) {
		if (action === 'delete') {
			this.stages.delete(rec.id);
			// its leads are deleted with it (cascade); don't wait for their events
			for (const l of [...this.leads.values()]) if (l.column === rec.id) this.leads.delete(l.id);
		} else put(this.stages, pickStage(rec), sameStage);
	}
}

// realtime and lists send the record with extra keys (collectionId, …): keep only ours
function pickLead(r: CompanyLead): CompanyLead {
	return {
		id: r.id,
		title: r.title ?? '',
		company: r.company ?? '',
		column: r.column ?? '',
		owner: r.owner ?? '',
		expected_close: r.expected_close ?? '',
		created: r.created ?? ''
	};
}

function pickStage(r: Stage): Stage {
	return {
		id: r.id,
		board: r.board ?? '',
		name: r.name ?? '',
		color: r.color ?? '',
		closed: !!r.closed,
		rank: r.rank ?? ''
	};
}

/** unchanged records keep their object (no re-render) */
function put<T extends { id: string }>(map: SvelteMap<string, T>, rec: T, same: (a: T, b: T) => boolean) {
	const cur = map.get(rec.id);
	if (!cur || !same(cur, rec)) map.set(rec.id, rec);
}

function replace<T extends { id: string }>(
	map: SvelteMap<string, T>,
	list: T[],
	same: (a: T, b: T) => boolean
) {
	const seen = new Set<string>();
	for (const rec of list) {
		seen.add(rec.id);
		put(map, rec, same);
	}
	for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
}

export const companyLeads = new CompanyLeadsStore();
