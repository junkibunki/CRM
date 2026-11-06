import { describe, expect, it } from 'vitest';
import { activeLeadCounts, isActive, leadsOfCompany, type CompanyLead, type Stage } from './leads';

const stages: Record<string, Stage> = {
	open: { id: 'open', board: 'b1', name: 'Neu', color: 'blue', closed: false, rank: 'a' },
	won: { id: 'won', board: 'b1', name: 'Gewonnen', color: 'green', closed: true, rank: 'b' },
	lost: { id: 'lost', board: 'b1', name: 'Verloren', color: 'red', closed: true, rank: 'c' },
	other: { id: 'other', board: 'b2', name: 'Andere Pipeline', color: '', rank: 'a' }
};
const stageOf = (id: string) => stages[id];

const lead = (id: string, company: string, column: string, created = '2026-01-01 10:00:00.000Z'): CompanyLead => ({
	id,
	title: `Lead ${id}`,
	company,
	column,
	owner: 'u1',
	expected_close: '',
	created
});

describe('isActive', () => {
	it('a lead in a closed stage is not active, in an open one it is', () => {
		expect(isActive(lead('l', 'c', 'open'), stageOf)).toBe(true);
		expect(isActive(lead('l', 'c', 'won'), stageOf)).toBe(false);
		expect(isActive(lead('l', 'c', 'lost'), stageOf)).toBe(false);
	});

	it('closed missing on the stage = open (older records)', () => {
		expect(isActive(lead('l', 'c', 'other'), stageOf)).toBe(true);
	});

	it('a stage not loaded (yet) counts as active', () => {
		expect(isActive(lead('l', 'c', 'unknown'), stageOf)).toBe(true);
	});
});

describe('activeLeadCounts', () => {
	it('counts only active leads, per company, across pipelines', () => {
		const m = activeLeadCounts(
			[
				lead('1', 'c1', 'open'),
				lead('2', 'c1', 'other'),
				lead('3', 'c1', 'won'),
				lead('4', 'c2', 'lost'),
				lead('5', 'c3', 'open')
			],
			stageOf
		);
		expect(m.get('c1')).toBe(2);
		expect(m.has('c2')).toBe(false); // only closed leads
		expect(m.get('c3')).toBe(1);
	});

	it('ignores leads without a company', () => {
		expect(activeLeadCounts([lead('1', '', 'open')], stageOf).size).toBe(0);
	});
});

describe('leadsOfCompany', () => {
	it('splits into active and closed, newest first, other companies left out', () => {
		const { active, closed } = leadsOfCompany(
			[
				lead('old', 'c1', 'open', '2026-01-01 10:00:00.000Z'),
				lead('new', 'c1', 'open', '2026-03-01 10:00:00.000Z'),
				lead('won', 'c1', 'won', '2026-02-01 10:00:00.000Z'),
				lead('lost', 'c1', 'lost', '2026-04-01 10:00:00.000Z'),
				lead('foreign', 'c2', 'open')
			],
			'c1',
			stageOf
		);
		expect(active.map((l) => l.id)).toEqual(['new', 'old']);
		expect(closed.map((l) => l.id)).toEqual(['lost', 'won']);
	});

	it('same creation time: stable order by id', () => {
		const { active } = leadsOfCompany([lead('b', 'c1', 'open'), lead('a', 'c1', 'open')], 'c1', stageOf);
		expect(active.map((l) => l.id)).toEqual(['a', 'b']);
	});

	it('no company id: nothing (not the leads without company)', () => {
		const r = leadsOfCompany([lead('1', '', 'open')], '', stageOf);
		expect(r).toEqual({ active: [], closed: [] });
	});
});
