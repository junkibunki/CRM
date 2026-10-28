import { describe, expect, it, vi } from 'vitest';

// a zone with an offset to UTC, so date-only vs. moment and "local day" bugs show up
// (Berlin: CET +1 from 25 Oct 2026). Set before anything creates a Date/Intl.
vi.hoisted(() => {
	process.env.TZ = 'Europe/Berlin';
});

import { countDue, endOfWeek, groupOf, groupTodos, GROUPS, matchesSearch } from './groups';
import type { OpenTodo } from './types';

/** local wall-clock time in Berlin */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
/** stored form of a to-do with time at that local moment */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
	local(y, m, d, h, min).toISOString().replace('T', ' ');

let n = 0;
const day = (due: string, extra: Partial<OpenTodo> = {}): OpenTodo => ({
	id: `t${++n}`,
	lead: 'l1',
	title: due,
	due: `${due} 00:00:00.000Z`,
	due_has_time: false,
	created: '2026-01-01 00:00:00.000Z',
	...extra
});
const timed = (due: string, extra: Partial<OpenTodo> = {}): OpenTodo => ({
	...day('x'),
	title: due,
	due,
	due_has_time: true,
	...extra
});

// Wednesday, 28 Oct 2026; the week ends on Sunday, 1 Nov
const WED = local(2026, 10, 28, 10);

describe('endOfWeek (weeks run Monday to Sunday)', () => {
	it('is the coming Sunday during the week', () => {
		expect(endOfWeek(WED)).toBe('2026-11-01');
		expect(endOfWeek(local(2026, 10, 26, 0, 0))).toBe('2026-11-01'); // Monday 00:00
	});

	it('is the same day on Sunday, also late in the evening', () => {
		expect(endOfWeek(local(2026, 11, 1, 23, 59))).toBe('2026-11-01');
	});

	it('jumps to the next Sunday on Monday', () => {
		expect(endOfWeek(local(2026, 11, 2, 0, 0))).toBe('2026-11-08');
	});

	it('crosses a month and a year end', () => {
		expect(endOfWeek(local(2026, 12, 30))).toBe('2027-01-03');
	});
});

describe('groupOf: date only', () => {
	it('yesterday overdue, today today, tomorrow to Sunday this week, Monday later', () => {
		expect(groupOf(day('2026-10-27'), WED)).toBe('overdue');
		expect(groupOf(day('2026-10-28'), WED)).toBe('today');
		expect(groupOf(day('2026-10-29'), WED)).toBe('week');
		expect(groupOf(day('2026-10-31'), WED)).toBe('week'); // Saturday
		expect(groupOf(day('2026-11-01'), WED)).toBe('week'); // Sunday
		expect(groupOf(day('2026-11-02'), WED)).toBe('later'); // next Monday
		expect(groupOf(day('2027-03-01'), WED)).toBe('later');
	});

	it('flips at local midnight, not at UTC midnight', () => {
		const lateWed = local(2026, 10, 28, 23, 59);
		const thuMidnight = local(2026, 10, 29, 0, 0); // still 28 Oct in UTC
		expect(groupOf(day('2026-10-28'), lateWed)).toBe('today');
		expect(groupOf(day('2026-10-28'), thuMidnight)).toBe('overdue');
		expect(groupOf(day('2026-10-29'), lateWed)).toBe('week');
		expect(groupOf(day('2026-10-29'), thuMidnight)).toBe('today');
	});

	it('on Sunday "this week" is empty: Monday is already later', () => {
		const sun = local(2026, 11, 1, 9);
		expect(groupOf(day('2026-11-01'), sun)).toBe('today');
		expect(groupOf(day('2026-11-02'), sun)).toBe('later');
	});

	it('on Saturday Sunday is still this week', () => {
		expect(groupOf(day('2026-11-01'), local(2026, 10, 31, 18))).toBe('week');
	});

	it('the week turns over at midnight from Sunday to Monday', () => {
		const sunLate = local(2026, 11, 1, 23, 59);
		const monMidnight = local(2026, 11, 2, 0, 0);
		expect(groupOf(day('2026-11-03'), sunLate)).toBe('later');
		expect(groupOf(day('2026-11-03'), monMidnight)).toBe('week');
	});
});

describe('groupOf: with time', () => {
	it('today before the moment, overdue from it on', () => {
		const t = timed(at(2026, 10, 28, 14));
		expect(groupOf(t, local(2026, 10, 28, 13, 59))).toBe('today');
		expect(groupOf(t, local(2026, 10, 28, 14, 0))).toBe('overdue');
	});

	it('uses the local day, not the UTC day of the stored moment', () => {
		// Thursday 00:30 in Berlin is Wednesday 23:30 UTC: tomorrow, not today
		expect(groupOf(timed(at(2026, 10, 29, 0, 30)), WED)).toBe('week');
		// Monday 00:30 in Berlin is Sunday 23:30 UTC: next week
		expect(groupOf(timed(at(2026, 11, 2, 0, 30)), WED)).toBe('later');
		// Sunday 23:30 in Berlin is still this week
		expect(groupOf(timed(at(2026, 11, 1, 23, 30)), WED)).toBe('week');
	});

	it('an earlier time yesterday is overdue', () => {
		expect(groupOf(timed(at(2026, 10, 27, 23, 0)), WED)).toBe('overdue');
	});
});

describe('groupTodos', () => {
	it('sorts every to-do into one group and keeps the group order of the page', () => {
		expect(GROUPS.map((g) => g.key)).toEqual(['overdue', 'today', 'week', 'later']);
		const g = groupTodos(
			[day('2026-11-10'), day('2026-10-20'), day('2026-10-28'), day('2026-10-30')],
			WED
		);
		expect(g.overdue.map((t) => t.title)).toEqual(['2026-10-20']);
		expect(g.today.map((t) => t.title)).toEqual(['2026-10-28']);
		expect(g.week.map((t) => t.title)).toEqual(['2026-10-30']);
		expect(g.later.map((t) => t.title)).toEqual(['2026-11-10']);
	});

	it('within a group: by day (oldest overdue first), date-only before times, then by time, then created', () => {
		const a = timed(at(2026, 10, 28, 15), { title: 'today 15:00' });
		const b = timed(at(2026, 10, 28, 11), { title: 'today 11:00' });
		const c = day('2026-10-28', { title: 'today, no time' });
		const d1 = day('2026-10-10', { title: 'old', created: '2026-02-01 00:00:00.000Z' });
		const d2 = day('2026-10-10', { title: 'old, created first', created: '2026-01-01 00:00:00.000Z' });
		const d3 = day('2026-10-26', { title: 'newer' });
		const g = groupTodos([a, d3, b, d1, c, d2], WED);
		expect(g.today.map((t) => t.title)).toEqual(['today, no time', 'today 11:00', 'today 15:00']);
		expect(g.overdue.map((t) => t.title)).toEqual(['old, created first', 'old', 'newer']);
	});

	it('a timed to-do earlier today moves from "today" to "overdue" as time passes', () => {
		const t = timed(at(2026, 10, 28, 9));
		expect(groupTodos([t], local(2026, 10, 28, 8)).today).toHaveLength(1);
		expect(groupTodos([t], local(2026, 10, 28, 9)).overdue).toHaveLength(1);
	});

	it('empty input: four empty groups', () => {
		expect(groupTodos([], WED)).toEqual({ overdue: [], today: [], week: [], later: [] });
	});
});

describe('matchesSearch', () => {
	const lead = { id: 'l1', title: 'Wartungsvertrag', owner: 'u2', company: 'c1' };
	const names = { company: (id: string) => (id === 'c1' ? 'Müller GmbH' : '') };
	const owner = (id: string) => (id === 'u2' ? 'Kim Kollegin' : '');
	const t = day('2026-10-28', { title: 'Angebot nachfassen' });

	it('an empty search matches everything', () => {
		expect(matchesSearch(t, lead, '', names)).toBe(true);
		expect(matchesSearch(t, undefined, '', names)).toBe(true);
	});

	it('finds title, lead title and company, case-insensitively for a lower-cased query', () => {
		expect(matchesSearch(t, lead, 'nachfassen', names)).toBe(true);
		expect(matchesSearch({ ...t, title: 'ANGEBOT' }, lead, 'angebot', names)).toBe(true);
		expect(matchesSearch(t, lead, 'wartung', names)).toBe(true);
		expect(matchesSearch(t, lead, 'müller', names)).toBe(true);
		expect(matchesSearch(t, lead, 'schneider', names)).toBe(false);
	});

	it('the owner only in the "all users" view (owner names given)', () => {
		expect(matchesSearch(t, lead, 'kim', names)).toBe(false);
		expect(matchesSearch(t, lead, 'kim', { ...names, owner })).toBe(true);
	});

	it('without a known lead only the title counts', () => {
		expect(matchesSearch(t, undefined, 'angebot', { ...names, owner })).toBe(true);
		expect(matchesSearch(t, undefined, 'wartung', { ...names, owner })).toBe(false);
	});
});

describe('countDue (navigation counter)', () => {
	it('counts overdue and due today, not this week or later', () => {
		const list = [
			day('2026-10-01'),
			timed(at(2026, 10, 28, 8)), // passed: overdue
			timed(at(2026, 10, 28, 18)), // later today
			day('2026-10-28'),
			day('2026-10-29'),
			day('2026-12-01')
		];
		expect(countDue(list, WED)).toEqual({ overdue: 2, today: 2 });
	});

	it('changes at midnight', () => {
		const list = [day('2026-10-28'), day('2026-10-29')];
		expect(countDue(list, local(2026, 10, 28, 23, 59))).toEqual({ overdue: 0, today: 1 });
		expect(countDue(list, local(2026, 10, 29, 0, 0))).toEqual({ overdue: 1, today: 1 });
	});
});
