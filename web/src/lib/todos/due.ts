// Due dates of to-dos: pure functions (unit-tested), all in the browser's local time zone.
// A to-do without time is stored as the calendar day `YYYY-MM-DD 00:00:00.000Z` (that day,
// wherever you are); one with time as the moment in UTC (entered in local time).
import type { DueStatus, OpenTodo, Todo } from './types';

type Due = Pick<Todo, 'due' | 'due_has_time'>;

const pad = (n: number) => String(n).padStart(2, '0');

/** local calendar day of a Date as YYYY-MM-DD */
export function localDay(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** PocketBase date string -> Date (invalid Date for '') */
function parse(pbDate: string): Date {
	return new Date(pbDate.replace(' ', 'T'));
}

/** The local calendar day (YYYY-MM-DD) a to-do is due on. */
export function dueDay(t: Due): string {
	if (!t.due) return '';
	return t.due_has_time ? localDay(parse(t.due)) : t.due.slice(0, 10);
}

/**
 * Overdue, today or in the future, relative to `now`:
 * - without time: overdue from the next (local) day on, "today" all of its day;
 * - with time: overdue from that moment on, "today" before it on the same local day.
 */
export function dueStatus(t: Due, now: Date): DueStatus {
	const today = localDay(now);
	if (t.due_has_time) {
		if (parse(t.due).getTime() <= now.getTime()) return 'overdue';
		return dueDay(t) === today ? 'today' : 'future';
	}
	const day = dueDay(t);
	if (day < today) return 'overdue';
	return day === today ? 'today' : 'future';
}

/**
 * Order of open to-dos: by local due day; within a day those without time first, then by
 * time; on a tie the one created first (then id, so the order is stable).
 */
export function compareTodos(a: OpenTodo, b: OpenTodo): number {
	const da = dueDay(a);
	const db = dueDay(b);
	if (da !== db) return da < db ? -1 : 1;
	if (a.due_has_time !== b.due_has_time) return a.due_has_time ? 1 : -1;
	if (a.due_has_time) {
		const ta = parse(a.due).getTime();
		const tb = parse(b.due).getTime();
		if (ta !== tb) return ta - tb;
	}
	if (a.created !== b.created) return a.created < b.created ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The next to-do: the open one that comes first (compareTodos); undefined if none. */
export function pickNext<T extends OpenTodo & { done?: boolean }>(list: Iterable<T>): T | undefined {
	let best: T | undefined;
	for (const t of list) {
		if (t.done) continue;
		if (!best || compareTodos(t, best) < 0) best = t;
	}
	return best;
}

/** Form values -> stored fields; null if the date (or the time) is not valid. */
export function fromDueInput(date: string, time: string): Due | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	if (!time) return { due: `${date} 00:00:00.000Z`, due_has_time: false };
	if (!/^\d{2}:\d{2}$/.test(time)) return null;
	const d = new Date(`${date}T${time}`); // no zone suffix: local time
	if (Number.isNaN(d.getTime())) return null;
	return { due: d.toISOString().replace('T', ' '), due_has_time: true };
}

/**
 * A time that doesn't exist on that day: the clocks jump from 02:00 to 03:00 when summer time
 * starts, so `new Date` (and fromDueInput) silently moves 02:30 to 03:30. Returns a hint for the
 * form naming the time that will be saved, '' for every other (or incomplete/invalid) input.
 */
export function dueGapNote(date: string, time: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return '';
	const d = new Date(`${date}T${time}`);
	if (Number.isNaN(d.getTime())) return '';
	const saved = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (localDay(d) === date && saved === time) return '';
	const [y, m, day] = date.split('-').map(Number);
	return `${time} Uhr gibt es am ${dayFormat.format(new Date(y, m - 1, day))} wegen der Zeitumstellung nicht – gespeichert wird ${saved} Uhr.`;
}

/** Stored fields -> form values (local date and, if any, local time HH:MM). */
export function toDueInput(t: Due): { date: string; time: string } {
	if (!t.due) return { date: '', time: '' };
	if (!t.due_has_time) return { date: t.due.slice(0, 10), time: '' };
	const d = parse(t.due);
	return { date: localDay(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export type QuickPick = 'today' | 'tomorrow' | 'next_week';

export const QUICK_PICKS: { key: QuickPick; label: string }[] = [
	{ key: 'today', label: 'Heute' },
	{ key: 'tomorrow', label: 'Morgen' },
	{ key: 'next_week', label: 'Nächste Woche' }
];

/** Quick pick -> local day (YYYY-MM-DD); "next week" is Monday of next week. */
export function quickDay(pick: QuickPick, now: Date): string {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	if (pick === 'tomorrow') d.setDate(d.getDate() + 1);
	else if (pick === 'next_week') d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
	return localDay(d);
}

// built once: Intl formatters are expensive (kanban.md, Performance)
const dayFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Whole local days from `now`'s day to `day` (YYYY-MM-DD): 0 = today, 1 = tomorrow, -1 = yesterday. */
export function daysFrom(day: string, now: Date): number {
	const [y, m, d] = day.split('-').map(Number);
	const a = new Date(y, m - 1, d);
	const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** "Heute", "Morgen", "Gestern" or "02.11.26", with ", 14:30" if it has a time. */
export function formatDue(t: Due, now: Date): string {
	const day = dueDay(t);
	if (!day) return '';
	const diff = daysFrom(day, now);
	const [y, m, d] = day.split('-').map(Number);
	const label =
		diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : dayFormat.format(new Date(y, m - 1, d));
	return t.due_has_time ? `${label}, ${timeFormat.format(parse(t.due))}` : label;
}

/** When a to-do was ticked off: "erledigt heute", "erledigt gestern" or "erledigt am 02.11.26". */
export function formatDone(doneAt: string, now: Date): string {
	const d = doneAt ? parse(doneAt) : null;
	if (!d || Number.isNaN(d.getTime())) return 'erledigt';
	const diff = daysFrom(localDay(d), now);
	return diff === 0 ? 'erledigt heute' : diff === -1 ? 'erledigt gestern' : `erledigt am ${dayFormat.format(d)}`;
}

/** Text for a to-do's title made from selected text: one line, at most `max` characters. */
export function titleFromText(text: string, max = 300): string {
	const one = text.replace(/\s+/g, ' ').trim();
	return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}
