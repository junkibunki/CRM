// Groups of the "Meine To-Dos" page: pure functions (unit-tested), local time zone.
import { compareTodos, dueDay, dueStatus, localDay } from './due';
import type { LeadInfo } from './mine.svelte';
import type { OpenTodo } from './types';

export type GroupKey = 'overdue' | 'today' | 'week' | 'later';

export const GROUPS: { key: GroupKey; label: string }[] = [
	{ key: 'overdue', label: 'Überfällig' },
	{ key: 'today', label: 'Heute' },
	{ key: 'week', label: 'Diese Woche' },
	{ key: 'later', label: 'Später' }
];

/** Local day (YYYY-MM-DD) of the Sunday that ends `now`'s week (weeks run Monday–Sunday). */
export function endOfWeek(now: Date): string {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
	return localDay(d);
}

/**
 * The group of an open to-do relative to `now`: overdue and today as on the card
 * (dueStatus), "this week" = from tomorrow up to Sunday, everything after that "later".
 */
export function groupOf(t: OpenTodo, now: Date): GroupKey {
	const status = dueStatus(t, now);
	if (status !== 'future') return status;
	return dueDay(t) <= endOfWeek(now) ? 'week' : 'later';
}

/** Open to-dos sorted into the four groups, each in to-do order (compareTodos). */
export function groupTodos<T extends OpenTodo>(list: Iterable<T>, now: Date): Record<GroupKey, T[]> {
	const groups: Record<GroupKey, T[]> = { overdue: [], today: [], week: [], later: [] };
	for (const t of list) groups[groupOf(t, now)].push(t);
	for (const g of Object.values(groups)) g.sort(compareTodos);
	return groups;
}

/** What the navigation counts: overdue and due today (the badge shows the sum). */
export function countDue(list: Iterable<OpenTodo>, now: Date): { overdue: number; today: number } {
	const n = { overdue: 0, today: 0 };
	for (const t of list) {
		const status = dueStatus(t, now);
		if (status !== 'future') n[status]++;
	}
	return n;
}

type Names = {
	company: (id: string) => string;
	/** only in the "all users" view: then the responsible user's name is searched too */
	owner?: (id: string) => string;
};

/**
 * Does a to-do match the search `q` (already trimmed and lower-cased; '' matches all)?
 * Searched: its title, the lead's title, the lead's company and, if `names.owner` is given,
 * the lead's owner.
 */
export function matchesSearch(t: OpenTodo, lead: LeadInfo | undefined, q: string, names: Names): boolean {
	if (!q) return true;
	const values = [t.title];
	if (lead) {
		values.push(lead.title, names.company(lead.company));
		if (names.owner) values.push(names.owner(lead.owner));
	}
	return values.some((v) => v?.toLowerCase().includes(q));
}
