import type { BoardColumn, Lead } from '../types';

/** Leads per company (rein, ohne Svelte). */

/** What the company pages need of a lead. */
export type CompanyLead = Pick<
	Lead,
	'id' | 'title' | 'company' | 'column' | 'owner' | 'expected_close' | 'created'
>;
/** What they need of a stage (to tell active from closed and show the stage). */
export type Stage = Pick<BoardColumn, 'id' | 'board' | 'name' | 'color' | 'closed' | 'rank'>;

export const LEAD_FIELDS = 'id,title,company,column,owner,expected_close,created';
export const STAGE_FIELDS = 'id,board,name,color,closed,rank';

type StageOf = (columnId: string) => Stage | undefined;

/**
 * Active = the lead's stage is not closed (won/lost). A stage not (yet) known counts as
 * active: a lead always has one, so that is only a moment between two realtime events.
 */
export function isActive(lead: Pick<CompanyLead, 'column'>, stageOf: StageOf) {
	return !stageOf(lead.column)?.closed;
}

/** Number of active leads per company id; companies without any are missing. */
export function activeLeadCounts(leads: Iterable<CompanyLead>, stageOf: StageOf): Map<string, number> {
	const m = new Map<string, number>();
	for (const l of leads) {
		if (l.company && isActive(l, stageOf)) m.set(l.company, (m.get(l.company) ?? 0) + 1);
	}
	return m;
}

/** A company's leads, split into active and closed ones, newest first in each. */
export function leadsOfCompany(
	leads: Iterable<CompanyLead>,
	companyId: string,
	stageOf: StageOf
): { active: CompanyLead[]; closed: CompanyLead[] } {
	const active: CompanyLead[] = [];
	const closed: CompanyLead[] = [];
	if (!companyId) return { active, closed };
	for (const l of leads) {
		if (l.company !== companyId) continue;
		(isActive(l, stageOf) ? active : closed).push(l);
	}
	// PocketBase date strings compare correctly as strings
	const newest = (a: CompanyLead, b: CompanyLead) =>
		b.created.localeCompare(a.created) || a.id.localeCompare(b.id);
	return { active: active.sort(newest), closed: closed.sort(newest) };
}
