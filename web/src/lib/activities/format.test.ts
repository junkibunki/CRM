import { describe, expect, it } from 'vitest';
import {
	compareActivities,
	dayKey,
	dayLabel,
	displayFileName,
	formatSize,
	fromDateTimeInput,
	groupByDay,
	isImageFile,
	matchesFilter,
	normalizeLink,
	parsePbDate,
	toDateTimeInput,
	toPbDate
} from './format';
import type { Activity, ActivityType } from './types';

function act(id: string, occurred: Date, type: ActivityType = 'note', created = '2026-01-01 00:00:00.000Z') {
	return { id, type, occurred_at: toPbDate(occurred), created } as Activity;
}

describe('compareActivities', () => {
	it('sorts newest first by occurred_at, then by entry time, then id', () => {
		const t = new Date(2026, 9, 28, 10);
		const list = [
			act('a', new Date(2026, 9, 27, 9)),
			act('b', t, 'note', '2026-10-28 08:00:00.000Z'),
			act('c', t, 'note', '2026-10-28 09:00:00.000Z'),
			act('d', new Date(2026, 9, 28, 12)),
			act('e', t, 'note', '2026-10-28 09:00:00.000Z')
		];
		expect(list.sort(compareActivities).map((a) => a.id)).toEqual(['d', 'e', 'c', 'b', 'a']);
	});
});

describe('matchesFilter', () => {
	it('matches by type; "email" covers both directions', () => {
		const types: ActivityType[] = ['note', 'meeting', 'email_in', 'email_out'];
		const pick = (f: Parameters<typeof matchesFilter>[1]) => types.filter((type) => matchesFilter({ type }, f));
		expect(pick('all')).toEqual(types);
		expect(pick('note')).toEqual(['note']);
		expect(pick('meeting')).toEqual(['meeting']);
		expect(pick('email')).toEqual(['email_in', 'email_out']);
	});
});

describe('dates', () => {
	it('round-trips datetime-local values in local time', () => {
		const local = '2026-10-28T09:05';
		const pbDate = fromDateTimeInput(local);
		expect(pbDate).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(parsePbDate(pbDate).getTime()).toBe(new Date(2026, 9, 28, 9, 5).getTime());
		expect(toDateTimeInput(pbDate)).toBe(local);
	});

	it('handles empty and invalid values', () => {
		expect(toDateTimeInput('')).toBe('');
		expect(fromDateTimeInput('')).toBe('');
		expect(fromDateTimeInput('kein datum')).toBe('');
	});

	it('uses the local calendar day', () => {
		expect(dayKey(toPbDate(new Date(2026, 0, 2, 0, 30)))).toBe('2026-01-02');
		expect(dayKey(toPbDate(new Date(2026, 0, 1, 23, 59)))).toBe('2026-01-01');
	});

	it('labels today and yesterday, otherwise the full German date', () => {
		const now = new Date(2026, 9, 28, 15);
		expect(dayLabel('2026-10-28', now)).toBe('Heute');
		expect(dayLabel('2026-10-27', now)).toBe('Gestern');
		expect(dayLabel('2026-10-26', now)).toBe('Montag, 26. Oktober 2026');
		// across a DST change (25 Oct 2026) still whole days
		expect(dayLabel('2026-10-24', now)).toBe('Samstag, 24. Oktober 2026');
	});
});

describe('groupByDay', () => {
	it('groups a sorted list by day and keeps the order', () => {
		const now = new Date(2026, 9, 28, 18);
		const list = [
			act('a', new Date(2026, 9, 28, 17)),
			act('b', new Date(2026, 9, 28, 8)),
			act('c', new Date(2026, 9, 27, 20)),
			act('d', new Date(2026, 8, 1, 12))
		];
		const groups = groupByDay(list, now);
		expect(groups.map((g) => [g.label, g.items.map((a) => a.id)])).toEqual([
			['Heute', ['a', 'b']],
			['Gestern', ['c']],
			['Dienstag, 1. September 2026', ['d']]
		]);
	});

	it('returns no groups for an empty list', () => {
		expect(groupByDay([])).toEqual([]);
	});
});

describe('files', () => {
	it('strips the random suffix PocketBase adds to stored names', () => {
		expect(displayFileName('protokoll_m_rz_w1eifse80u.txt')).toBe('protokoll_m_rz.txt');
		expect(displayFileName('angebot_v2_abcdefghij.pdf')).toBe('angebot_v2.pdf');
		expect(displayFileName('readme_abcdefghij')).toBe('readme');
		expect(displayFileName('kurz.pdf')).toBe('kurz.pdf');
	});

	it('formats sizes German', () => {
		expect(formatSize(512)).toBe('512 B');
		expect(formatSize(1536)).toBe('1,5 KB');
		expect(formatSize(20 * 1024 * 1024)).toBe('20 MB');
	});

	it('normalises links typed into the editor and refuses other schemes', () => {
		expect(normalizeLink('https://example.com/a')).toBe('https://example.com/a');
		expect(normalizeLink(' example.com ')).toBe('https://example.com');
		expect(normalizeLink('localhost:5173/x')).toBe('https://localhost:5173/x');
		expect(normalizeLink('anna@example.com')).toBe('mailto:anna@example.com');
		expect(normalizeLink('mailto:anna@example.com')).toBe('mailto:anna@example.com');
		expect(normalizeLink('tel:+4930123')).toBe('tel:+4930123');
		expect(normalizeLink('javascript:alert(1)')).toBeNull();
		expect(normalizeLink('JavaScript:alert(1)')).toBeNull();
		expect(normalizeLink('data:text/html,x')).toBeNull();
		expect(normalizeLink('')).toBeNull();
		expect(normalizeLink('zwei worte')).toBeNull();
	});

	it('recognises images PocketBase can preview', () => {
		expect(isImageFile('foto_abcdefghij.JPG')).toBe(true);
		expect(isImageFile('a.webp')).toBe(true);
		expect(isImageFile('a.pdf')).toBe(false);
		expect(isImageFile('a.svg')).toBe(false);
	});
});
