import { describe, expect, it, vi } from 'vitest';

// a zone with an offset to UTC, so date-only vs. moment and "local day" bugs show up
// (Berlin: CEST +2 until 25 Oct 2026, then CET +1). Set before anything creates a Date/Intl.
vi.hoisted(() => {
	process.env.TZ = 'Europe/Berlin';
});

import {
	compareTodos,
	daysFrom,
	dueDay,
	dueStatus,
	formatDue,
	fromDueInput,
	localDay,
	pickNext,
	quickDay,
	titleFromText,
	toDueInput
} from './due';
import type { OpenTodo } from './types';

/** local wall-clock time in Berlin */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

const todo = (id: string, due: string, hasTime = false, extra: Partial<OpenTodo> = {}): OpenTodo => ({
	id,
	lead: 'l1',
	title: id,
	due,
	due_has_time: hasTime,
	created: '2026-01-01 00:00:00.000Z',
	...extra
});

describe('time zone of these tests', () => {
	it('is Berlin (UTC+1 in winter)', () => {
		expect(new Date('2026-10-28T23:30:00Z').getDate()).toBe(29);
	});
});

describe('dueDay', () => {
	it('takes the stored day of a to-do without time as is', () => {
		expect(dueDay(todo('a', '2026-10-28 00:00:00.000Z'))).toBe('2026-10-28');
	});
	it('takes the local day of a to-do with time', () => {
		// 23:30 UTC = 00:30 the next day in Berlin
		expect(dueDay(todo('a', '2026-10-28 23:30:00.000Z', true))).toBe('2026-10-29');
		// 22:30 UTC on 30 Oct (CET +1) = 23:30 the same day
		expect(dueDay(todo('a', '2026-10-30 22:30:00.000Z', true))).toBe('2026-10-30');
	});
	it('is empty without a date', () => {
		expect(dueDay(todo('a', ''))).toBe('');
	});
});

describe('dueStatus: without time', () => {
	const t = todo('a', '2026-10-28 00:00:00.000Z');
	it('is "today" the whole local day, also right after midnight (still the previous day in UTC)', () => {
		expect(dueStatus(t, local(2026, 10, 28, 0, 30))).toBe('today');
		expect(dueStatus(t, local(2026, 10, 28, 23, 59))).toBe('today');
	});
	it('is overdue from the next local day on', () => {
		expect(dueStatus(t, local(2026, 10, 29, 0, 0))).toBe('overdue');
		expect(dueStatus(t, local(2026, 11, 3))).toBe('overdue');
	});
	it('is in the future before its day', () => {
		expect(dueStatus(t, local(2026, 10, 27, 23, 59))).toBe('future');
	});
});

describe('dueStatus: with time', () => {
	const at14 = fromDueInput('2026-10-28', '14:00')!;
	const t = todo('a', at14.due, true);
	it('stores 14:00 Berlin as 13:00 UTC', () => {
		expect(at14).toEqual({ due: '2026-10-28 13:00:00.000Z', due_has_time: true });
	});
	it('is "today" before the moment on the same day', () => {
		expect(dueStatus(t, local(2026, 10, 28, 8))).toBe('today');
		expect(dueStatus(t, local(2026, 10, 28, 13, 59))).toBe('today');
	});
	it('is overdue from the moment on', () => {
		expect(dueStatus(t, local(2026, 10, 28, 14, 0))).toBe('overdue');
		expect(dueStatus(t, local(2026, 10, 29, 9))).toBe('overdue');
	});
	it('is in the future on an earlier day', () => {
		expect(dueStatus(t, local(2026, 10, 27, 20))).toBe('future');
	});
});

describe('compareTodos / pickNext', () => {
	it('orders by local day first, a to-do with time counted on its local day', () => {
		// 00:30 on 29 Oct in Berlin is 28 Oct in UTC: still after the date-only 28 Oct
		const late = todo('late', '2026-10-28 23:30:00.000Z', true);
		const day28 = todo('d28', '2026-10-28 00:00:00.000Z');
		const day29 = todo('d29', '2026-10-29 00:00:00.000Z');
		expect([late, day29, day28].sort(compareTodos).map((t) => t.id)).toEqual(['d28', 'd29', 'late']);
	});
	it('puts to-dos without time before those with time on the same day, those by time', () => {
		const t9 = todo('t9', fromDueInput('2026-10-28', '09:00')!.due, true);
		const t8 = todo('t8', fromDueInput('2026-10-28', '08:00')!.due, true);
		const allDay = todo('allDay', '2026-10-28 00:00:00.000Z');
		expect([t9, t8, allDay].sort(compareTodos).map((t) => t.id)).toEqual(['allDay', 't8', 't9']);
	});
	it('takes the one created first on a tie, then the id', () => {
		const a = todo('b', '2026-10-28 00:00:00.000Z', false, { created: '2026-01-02 00:00:00.000Z' });
		const b = todo('c', '2026-10-28 00:00:00.000Z', false, { created: '2026-01-01 00:00:00.000Z' });
		const c = todo('a', '2026-10-28 00:00:00.000Z', false, { created: '2026-01-02 00:00:00.000Z' });
		expect([a, b, c].sort(compareTodos).map((t) => t.id)).toEqual(['c', 'a', 'b']);
	});
	it('picks the first open one and skips done ones', () => {
		const list = [
			{ ...todo('done', '2026-10-01 00:00:00.000Z'), done: true },
			todo('later', '2026-11-01 00:00:00.000Z'),
			todo('next', '2026-10-20 00:00:00.000Z')
		];
		expect(pickNext(list)?.id).toBe('next');
		expect(pickNext([{ ...todo('x', '2026-10-01 00:00:00.000Z'), done: true }])).toBeUndefined();
		expect(pickNext([])).toBeUndefined();
	});
});

describe('form values', () => {
	it('stores a day without time as UTC midnight of that day', () => {
		expect(fromDueInput('2026-10-28', '')).toEqual({ due: '2026-10-28 00:00:00.000Z', due_has_time: false });
	});
	it('refuses invalid dates and times', () => {
		expect(fromDueInput('', '')).toBeNull();
		expect(fromDueInput('28.10.2026', '')).toBeNull();
		expect(fromDueInput('2026-10-28', '9 Uhr')).toBeNull();
		expect(fromDueInput('2026-13-45', '10:00')).toBeNull();
	});
	it('round-trips local date and time', () => {
		for (const [date, time] of [
			['2026-10-28', ''],
			['2026-10-28', '00:30'],
			['2026-03-29', '03:30'], // DST day (02:00-03:00 does not exist)
			['2026-07-01', '23:45']
		]) {
			const v = fromDueInput(date, time)!;
			expect(toDueInput(v)).toEqual({ date, time });
		}
	});
	it('is empty without a date', () => {
		expect(toDueInput({ due: '', due_has_time: false })).toEqual({ date: '', time: '' });
	});
});

describe('quick picks', () => {
	it('today and tomorrow in local time, also late in the evening and at month end', () => {
		expect(quickDay('today', local(2026, 10, 28, 23, 30))).toBe('2026-10-28');
		expect(quickDay('tomorrow', local(2026, 10, 31, 23, 30))).toBe('2026-11-01');
		expect(quickDay('tomorrow', local(2026, 10, 24, 12))).toBe('2026-10-25'); // DST change
	});
	it('"next week" is Monday of next week', () => {
		expect(quickDay('next_week', local(2026, 10, 28))).toBe('2026-11-02'); // Wednesday
		expect(quickDay('next_week', local(2026, 11, 1))).toBe('2026-11-02'); // Sunday
		expect(quickDay('next_week', local(2026, 11, 2))).toBe('2026-11-09'); // Monday
	});
});

describe('formatDue', () => {
	const now = local(2026, 10, 28, 10);
	it('names today, tomorrow and yesterday, else the date', () => {
		expect(formatDue(todo('a', '2026-10-28 00:00:00.000Z'), now)).toBe('Heute');
		expect(formatDue(todo('a', '2026-10-29 00:00:00.000Z'), now)).toBe('Morgen');
		expect(formatDue(todo('a', '2026-10-27 00:00:00.000Z'), now)).toBe('Gestern');
		expect(formatDue(todo('a', '2026-11-02 00:00:00.000Z'), now)).toBe('02.11.26');
	});
	it('adds the local time', () => {
		expect(formatDue(todo('a', fromDueInput('2026-10-28', '14:30')!.due, true), now)).toBe('Heute, 14:30');
		expect(formatDue(todo('a', '2026-10-28 23:30:00.000Z', true), now)).toBe('Morgen, 00:30');
	});
	it('counts calendar days, not 24-hour spans', () => {
		expect(daysFrom('2026-10-29', local(2026, 10, 28, 23, 59))).toBe(1);
		expect(daysFrom('2026-10-26', local(2026, 10, 25, 0, 1))).toBe(1); // 25 hours that day
	});
});

describe('localDay / titleFromText', () => {
	it('formats the local day', () => {
		expect(localDay(local(2026, 1, 5, 0, 10))).toBe('2026-01-05');
	});
	it('makes one trimmed line of a selection and shortens it', () => {
		expect(titleFromText('  Angebot\n\n  bis  Freitag ')).toBe('Angebot bis Freitag');
		const long = titleFromText('x'.repeat(400), 300);
		expect(long).toHaveLength(300);
		expect(long.endsWith('…')).toBe(true);
	});
});
