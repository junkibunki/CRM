import type { RecordModel } from 'pocketbase';

export type RequirementType = 'flag' | 'text';

export const REQUIREMENT_TYPES: { value: RequirementType; label: string }[] = [
	{ value: 'flag', label: 'Ja/Nein' },
	{ value: 'text', label: 'Text' }
];

/** A requirement of a stage: applies to that stage and every later one of the pipeline. */
export interface StageRequirement extends RecordModel {
	column: string;
	label: string;
	type: RequirementType;
	/** e.g. whom to inform; shown below the checkbox / text field */
	hint: string;
	rank: string;
}

/** A lead fulfils a requirement (flag: value "true", text: not blank). Revoke = delete. */
export interface LeadCheck extends RecordModel {
	lead: string;
	requirement: string;
	value: string;
	/** who confirmed or last changed it ('' = superuser / import) */
	by: string;
	created: string;
	updated: string;
}

export type CheckAction = 'confirmed' | 'changed' | 'revoked';

/** Log entry, written only by the server hook. */
export interface CheckEvent extends RecordModel {
	lead: string;
	/** '' once the requirement was deleted; the label is a copy */
	requirement: string;
	requirement_label: string;
	action: CheckAction;
	value: string;
	by: string;
	created: string;
}

/** A confirmation as sent from the gate dialog. */
export type CheckEntry = { requirement: string; value: string };

/** Data the requirements editor edits (one row). `id` is set for existing requirements. */
export type RequirementDraft = {
	key: string;
	id?: string;
	label: string;
	type: RequirementType;
	hint: string;
};

/** What the stage dialog hands over: the draft and the requirements when it opened. */
export type RequirementChange = { draft: RequirementDraft[]; initial: StageRequirement[] };
