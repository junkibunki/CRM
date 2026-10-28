import { describe, expect, it } from 'vitest';
import type { BoardColumn } from '../types';
import { tileRows } from './tile';
import type { LeadCheck, StageRequirement } from './types';

const stages = [
	{ id: 'neu', board: 'b', rank: 'a0', name: 'Neu' },
	{ id: 'ang', board: 'b', rank: 'a1', name: 'Angebot' },
	{ id: 'verh', board: 'b', rank: 'a2', name: 'Verhandlung' }
] as BoardColumn[];
const reqs = [
	{ id: 'flag', column: 'ang', rank: 'a0', label: 'Flag', type: 'flag', hint: '' },
	{ id: 'nr', column: 'verh', rank: 'a0', label: 'Nummer', type: 'text', hint: '' }
] as StageRequirement[];

describe('tileRows', () => {
	it('lists every requirement of the pipeline; those up to the current stage apply', () => {
		const rows = tileRows(reqs, stages, 'ang', undefined);
		expect(rows.map((r) => [r.requirement.id, r.stage, r.applies, r.done])).toEqual([
			['flag', 'Angebot', true, false],
			['nr', 'Verhandlung', false, false]
		]);
	});

	it('marks fulfilled checks done (blank text stays open)', () => {
		const checks = {
			flag: { id: 'c1', requirement: 'flag', value: 'true' } as LeadCheck,
			nr: { id: 'c2', requirement: 'nr', value: ' ' } as LeadCheck
		};
		const rows = tileRows(reqs, stages, 'verh', checks);
		expect(rows.map((r) => [r.requirement.id, r.applies, r.done])).toEqual([
			['flag', true, true],
			['nr', true, false]
		]);
	});

	it('nothing applies in the first stage', () => {
		expect(tileRows(reqs, stages, 'neu', undefined).every((r) => !r.applies)).toBe(true);
	});

	it('in an exempt last stage ("Verloren") every requirement is still listed, none applies', () => {
		const withLost = [...stages, { id: 'verl', board: 'b', rank: 'a3', name: 'Verloren', gates_exempt: true }] as BoardColumn[];
		const rows = tileRows(reqs, withLost, 'verl', undefined);
		expect(rows.map((r) => [r.requirement.id, r.applies])).toEqual([
			['flag', false],
			['nr', false]
		]);
	});
});
