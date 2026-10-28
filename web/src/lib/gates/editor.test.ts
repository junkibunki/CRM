import { describe, expect, it } from 'vitest';
import { freshRanks } from '../rank';
import { draftError, newDraft, planRequirements, toDrafts } from './editor';
import type { StageRequirement } from './types';

const [r0, r1, r2] = freshRanks(3);
const req = (id: string, rank: string, extra: Partial<StageRequirement> = {}): StageRequirement =>
	({ id, column: 'c1', label: `L-${id}`, type: 'flag', hint: '', rank, ...extra }) as StageRequirement;

describe('planRequirements', () => {
	const initial = [req('a', r0), req('b', r1, { type: 'text', hint: 'H' })];

	it('unchanged draft: nothing to send', () => {
		expect(planRequirements(initial, toDrafts(initial))).toEqual({ create: [], update: [], remove: [] });
	});

	it('creates new rows with ranks in draft order, trimmed', () => {
		const draft = [...toDrafts(initial), { ...newDraft(), label: '  Neu  ', type: 'text' as const, hint: ' wen ' }];
		const plan = planRequirements(initial, draft);
		expect(plan.create).toEqual([{ label: 'Neu', type: 'text', hint: 'wen', rank: r2 }]);
		expect(plan.update).toEqual([]);
	});

	it('updates only changed fields', () => {
		const draft = toDrafts(initial);
		draft[1].label = 'Anders';
		expect(planRequirements(initial, draft).update).toEqual([{ id: 'b', data: { label: 'Anders' } }]);
	});

	it('deletes removed rows; the rest keeps its rank if the order is unchanged', () => {
		const draft = toDrafts(initial).slice(0, 1);
		expect(planRequirements(initial, draft)).toEqual({ create: [], update: [], remove: ['b'] });
	});

	it('reordering sends new ranks', () => {
		const draft = toDrafts(initial).reverse();
		const plan = planRequirements(initial, draft);
		expect(plan.update).toEqual([
			{ id: 'b', data: { rank: r0 } },
			{ id: 'a', data: { rank: r1 } }
		]);
	});

	it('a requirement with an odd rank (seed, API) gets a fresh one', () => {
		const odd = [req('a', 'a0V')];
		expect(planRequirements(odd, toDrafts(odd)).update).toEqual([{ id: 'a', data: { rank: r0 } }]);
	});
});

describe('draftError', () => {
	it('needs a label on every row', () => {
		expect(draftError([{ ...newDraft(), label: ' ' }])).not.toBe('');
		expect(draftError([{ ...newDraft(), label: 'x' }])).toBe('');
		expect(draftError([])).toBe('');
	});
});
