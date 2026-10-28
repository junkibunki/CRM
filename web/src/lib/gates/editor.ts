// What saving the requirements editor of a stage sends (pure, unit-tested).
import { changedFields } from '../diff';
import { freshRanks } from '../rank';
import type { RequirementDraft, StageRequirement } from './types';

type Data = Pick<StageRequirement, 'label' | 'type' | 'hint'>;

export type RequirementPlan = {
	create: (Data & { rank: string })[];
	update: { id: string; data: Partial<Data & { rank: string }> }[];
	remove: string[];
};

let seq = 0;
/** a draft row for a new requirement (key only for the {#each}) */
export function newDraft(): RequirementDraft {
	return { key: `new-${++seq}`, label: '', type: 'flag', hint: '' };
}

/** draft rows for the requirements of a stage, in their order */
export function toDrafts(list: readonly StageRequirement[]): RequirementDraft[] {
	return list.map((r) => ({ key: r.id, id: r.id, label: r.label, type: r.type, hint: r.hint ?? '' }));
}

/** the first problem of the draft, or '' */
export function draftError(draft: readonly RequirementDraft[]): string {
	if (draft.some((d) => !d.label.trim())) return 'Jede Bedingung braucht eine Bezeichnung.';
	return '';
}

/**
 * Creates, updates (only changed fields) and deletes that turn `initial` (the requirements
 * of the stage when the dialog opened) into `draft`. Ranks follow the draft order; with
 * evenly spaced keys an unchanged order sends no rank at all.
 */
export function planRequirements(
	initial: readonly StageRequirement[],
	draft: readonly RequirementDraft[]
): RequirementPlan {
	const ranks = freshRanks(draft.length);
	const byId = new Map(initial.map((r) => [r.id, r]));
	const kept = new Set<string>();
	const plan: RequirementPlan = { create: [], update: [], remove: [] };
	draft.forEach((d, i) => {
		const data: Data = { label: d.label.trim(), type: d.type, hint: d.hint.trim() };
		const cur = d.id ? byId.get(d.id) : undefined;
		if (!cur) {
			plan.create.push({ ...data, rank: ranks[i] });
			return;
		}
		kept.add(cur.id);
		const changed: Partial<Data & { rank: string }> = changedFields(
			{ label: cur.label, type: cur.type, hint: cur.hint ?? '', rank: cur.rank },
			{ ...data, rank: ranks[i] }
		);
		if (Object.keys(changed).length) plan.update.push({ id: cur.id, data: changed });
	});
	for (const r of initial) if (!kept.has(r.id)) plan.remove.push(r.id);
	return plan;
}
