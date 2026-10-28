import type { BoardStore } from '../board.svelte';
import { errorMessage } from '../pb';
import type { BoardColumn } from '../types';
import { gateError } from './evaluate';
import type { GateStore } from './gates.svelte';
import type { CheckEntry, StageRequirement } from './types';

/** What the gate dialog shows and does when confirmed. */
export type GateRequest = {
	title: string;
	description?: string;
	requirements: StageRequirement[];
	/** prefilled values (requirement id -> value), e.g. when changing a text */
	initial?: Record<string, string>;
	confirmLabel: string;
	/** saves; resolves an error text (dialog stays open) or null (dialog closes) */
	run: (entries: CheckEntry[]) => Promise<string | null>;
};

/**
 * State of one gate dialog (`GateDialog`). Pages keep one prompt and let `gateMove` /
 * `ask` fill it; the dialog binds to `open` and calls `confirm`.
 */
export class GatePrompt {
	open = $state(false);
	request = $state<GateRequest | null>(null);

	ask(request: GateRequest) {
		this.request = request;
		this.open = true;
	}

	/** runs the request; closes on success, otherwise returns the error text */
	async confirm(entries: CheckEntry[]): Promise<string | null> {
		const req = this.request;
		if (!req) return null;
		const err = await req.run(entries);
		if (!err && this.request === req) this.open = false;
		return err;
	}

	/** "Abbrechen": nothing is saved, nothing moves */
	cancel() {
		this.open = false;
	}
}

export const GATES_LOADING = 'Die Bedingungen der Phasen werden noch geladen – bitte gleich noch einmal versuchen.';

export type CreatePlan =
	| { kind: 'wait' }
	| { kind: 'direct' }
	| { kind: 'gate'; requirements: StageRequirement[] };

/**
 * Creating a lead in `columnId` (LeadDialog): `wait` while the requirements are not loaded
 * (nothing is created), `gate` if the stage has requirements (confirm first, then the route),
 * otherwise `direct`. Without a gate store (not wired) always `direct`.
 */
export function createPlan(
	gates: GateStore | undefined,
	columns: readonly Pick<BoardColumn, 'id' | 'board' | 'rank' | 'gates_exempt'>[] | undefined,
	columnId: string
): CreatePlan {
	if (!gates || !columns) return { kind: 'direct' };
	if (!gates.loaded) return { kind: 'wait' };
	const requirements = gates.applicableFor(columnId, columns);
	return requirements.length ? { kind: 'gate', requirements } : { kind: 'direct' };
}

/** text for a failed confirmation or move */
export function gateFailure(err: unknown) {
	return gateError(err) ?? errorMessage(err);
}

export type MoveOptions = {
	gates: GateStore | undefined;
	prompt: GatePrompt;
	lead: { id: string; title: string };
	target: Pick<BoardColumn, 'id' | 'name'>;
	columns: readonly Pick<BoardColumn, 'id' | 'board' | 'rank' | 'gates_exempt'>[];
	/** the actual move (BoardStore.moveLead, LeadStore.moveToStage) */
	move: () => unknown;
};

/**
 * Moves a lead into another stage, through the gate: fulfilled (or no) requirements -> the
 * move runs right away; open ones -> the dialog asks first, and only "Bestätigen und
 * verschieben" saves the confirmations and THEN moves (no optimistic move before that).
 * "Abbrechen" leaves the lead where it is. Returns whether the dialog was opened.
 */
export function gateMove({ gates, prompt, lead, target, columns, move }: MoveOptions): boolean {
	// requirements not known yet: no move (it might skip the dialog), just a short hint
	if (gates && !gates.loaded) {
		gates.error = GATES_LOADING;
		return false;
	}
	const open = gates ? gates.openFor(lead.id, target.id, columns) : [];
	if (!gates || !open.length) {
		move();
		return false;
	}
	prompt.ask({
		title: `Bevor „${lead.title}“ nach „${target.name}“ kann`,
		description:
			open.length === 1
				? 'Diese Bedingung ist noch offen:'
				: `Diese ${open.length} Bedingungen sind noch offen:`,
		requirements: open,
		confirmLabel: 'Bestätigen und verschieben',
		run: async (entries) => {
			try {
				await gates.confirm(lead.id, entries);
			} catch (err) {
				return gateFailure(err);
			}
			move();
			return null;
		}
	});
	return true;
}

/**
 * A card dropped on the board (index maths from drop.ts): within its stage it just moves,
 * into another stage it goes through the gate (`gateMove`).
 */
export function moveOnBoard(
	store: BoardStore,
	gates: GateStore | undefined,
	prompt: GatePrompt,
	id: string,
	columnId: string,
	toIndex: number
) {
	const loc = store.findLead(id);
	const target = store.columns.find((c) => c.id === columnId);
	if (!loc || !target || loc.column === columnId) {
		store.moveLead(id, columnId, toIndex);
		return;
	}
	gateMove({
		gates,
		prompt,
		lead: store.leads[loc.column][loc.index],
		target,
		columns: store.columns,
		move: () => store.moveLead(id, columnId, toIndex)
	});
}
