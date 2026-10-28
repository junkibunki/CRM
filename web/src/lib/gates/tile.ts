// Rows of the "Bedingungen" tile on the lead page (pure, unit-tested).
import type { BoardColumn } from '../types';
import { applicable, fulfilled, pipelineRequirements } from './evaluate';
import type { CheckAction, LeadCheck, StageRequirement } from './types';

export type TileRow = {
	requirement: StageRequirement;
	/** name of the stage the requirement belongs to ("ab <Phase>") */
	stage: string;
	/** applies to the lead's current stage (open = warning) */
	applies: boolean;
	check: LeadCheck | undefined;
	done: boolean;
};

/**
 * Every requirement of the lead's pipeline in stage order: those of the current and earlier
 * stages first (they apply), then those of later stages (can be confirmed in advance).
 */
export function tileRows(
	requirements: readonly StageRequirement[],
	stages: readonly BoardColumn[],
	leadColumn: string,
	checks: Readonly<Record<string, LeadCheck>> | undefined
): TileRow[] {
	const sorted = pipelineRequirements(requirements, stages, leadColumn);
	const now = new Set(applicable(requirements, stages, leadColumn).map((r) => r.id));
	const names = new Map(stages.map((s) => [s.id, s.name]));
	return sorted.map((r) => {
		const check = checks?.[r.id];
		return {
			requirement: r,
			stage: names.get(r.column) ?? '',
			applies: now.has(r.id),
			check,
			done: fulfilled(r, check)
		};
	});
}

export const ACTION_LABELS: Record<CheckAction, string> = {
	confirmed: 'bestätigt',
	changed: 'geändert',
	revoked: 'zurückgenommen'
};
