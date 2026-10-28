// Gate evaluation in the client: same rules as pocketbase/pb_hooks/stage-gates-lib.js (the
// server enforces them; gates-lib.test.ts checks that both agree).
import { ClientResponseError } from 'pocketbase';
import { byRank } from '../rank';
import type { BoardColumn } from '../types';
import type { CheckEntry, StageRequirement } from './types';

type Column = Pick<BoardColumn, 'id' | 'board' | 'rank' | 'gates_exempt'>;
type Requirement = Pick<StageRequirement, 'id' | 'column' | 'rank' | 'type'>;
type Check = { requirement: string; value: string };

/** the server's error code for a refused move (ValidationError on `column`) */
export const GATE_CODE = 'gate_open';

function upTo<R extends Requirement>(
	requirements: readonly R[],
	columns: readonly Column[],
	columnId: string,
	all: boolean
): R[] {
	const target = columns.find((c) => c.id === columnId);
	// an exempt stage exempts only itself: its requirements still count for later stages
	if (!target || (!all && target.gates_exempt)) return [];
	const stages = columns.filter((c) => c.board === target.board).sort(byRank);
	const pos = new Map(stages.map((c, i) => [c.id, i]));
	const limit = all ? stages.length : stages.indexOf(target);
	return requirements
		.filter((r) => (pos.get(r.column) ?? Infinity) <= limit)
		.sort((a, b) => pos.get(a.column)! - pos.get(b.column)! || byRank(a, b));
}

/**
 * The requirements that apply to `columnId`: those of its stage and every earlier stage of
 * the same pipeline (by rank), in stage order, then requirement order. None in an exempt
 * stage (`gates_exempt`, e.g. "Verloren"); it exempts only itself, not later stages.
 * Requirements of stages not in `columns` are ignored.
 */
export function applicable<R extends Requirement>(
	requirements: readonly R[],
	columns: readonly Column[],
	columnId: string
): R[] {
	return upTo(requirements, columns, columnId, false);
}

/** every requirement of the pipeline of `columnId` that can ever apply, in order */
export function pipelineRequirements<R extends Requirement>(
	requirements: readonly R[],
	columns: readonly Column[],
	columnId: string
): R[] {
	return upTo(requirements, columns, columnId, true);
}

/** flag: "true"; text: not blank */
export function fulfilled(requirement: Pick<Requirement, 'type'>, check: Check | undefined): boolean {
	if (!check) return false;
	const v = check.value ?? '';
	return requirement.type === 'flag' ? v === 'true' : v.trim() !== '';
}

/** `list` without the requirements that `checks` (requirement id -> check) fulfil */
export function openOf<R extends Requirement>(
	list: readonly R[],
	checks: Readonly<Record<string, Check>> | undefined
): R[] {
	return list.filter((r) => !fulfilled(r, checks?.[r.id]));
}

/** the requirements of `columnId` (cumulative) a lead with `checks` has not fulfilled */
export function openRequirements<R extends Requirement>(
	requirements: readonly R[],
	columns: readonly Column[],
	columnId: string,
	checks: readonly Check[]
): R[] {
	const byReq: Record<string, Check> = {};
	for (const c of checks) byReq[c.requirement] = c;
	return openOf(applicable(requirements, columns, columnId), byReq);
}

/** value to store, or an error text; same rules as the server */
export function normalizeValue(
	requirement: Pick<Requirement, 'type'>,
	value: string | boolean
): { value: string } | { error: string } {
	if (requirement.type === 'flag') {
		return value === true || value === 'true' ? { value: 'true' } : { error: 'Bitte bestätigen.' };
	}
	const v = String(value ?? '').trim();
	if (!v) return { error: 'Bitte einen Wert eintragen.' };
	if (v.length > 1000) return { error: 'Höchstens 1000 Zeichen.' };
	return { value: v };
}

/** entries of the gate dialog that are not (yet) valid, as "label: error" */
export function entryErrors(
	requirements: readonly Pick<StageRequirement, 'id' | 'label' | 'type'>[],
	entries: readonly CheckEntry[]
): string[] {
	const byReq = new Map(entries.map((e) => [e.requirement, e.value]));
	const out: string[] = [];
	for (const r of requirements) {
		const n = normalizeValue(r, byReq.get(r.id) ?? '');
		if ('error' in n) out.push(`${r.label}: ${n.error}`);
	}
	return out;
}

/** The server's text for a refused move (open requirements), or null for any other error. */
export function gateError(err: unknown): string | null {
	if (!(err instanceof ClientResponseError) || err.status !== 400) return null;
	const col = (err.response?.data as Record<string, { code?: string; message?: string }> | undefined)
		?.column;
	return col?.code === GATE_CODE && col.message ? col.message : null;
}
