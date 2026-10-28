import type { Activity, ActivityFilter } from './types';

/** Newest first: by `occurred_at`, then by entry time, then id (stable for equal times). */
export function compareActivities(a: Activity, b: Activity): number {
	if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? 1 : -1;
	if (a.created !== b.created) return a.created < b.created ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function matchesFilter(a: Pick<Activity, 'type'>, filter: ActivityFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'email') return a.type === 'email_in' || a.type === 'email_out';
	return a.type === filter;
}

/** PocketBase date string (`YYYY-MM-DD HH:MM:SS.sssZ`, UTC) -> Date */
export function parsePbDate(pbDate: string): Date {
	return new Date(pbDate.replace(' ', 'T'));
}

/** Date -> PocketBase date string (UTC) */
export function toPbDate(d: Date): string {
	return d.toISOString().replace('T', ' ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** local calendar day `YYYY-MM-DD` of a PocketBase date */
export function dayKey(pbDate: string): string {
	const d = parsePbDate(pbDate);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** PocketBase date -> value for <input type="datetime-local"> (local time, minutes) */
export function toDateTimeInput(pbDate: string): string {
	if (!pbDate) return '';
	const d = parsePbDate(pbDate);
	return `${dayKey(pbDate)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) -> PocketBase date string, '' if invalid */
export function fromDateTimeInput(value: string): string {
	if (!value) return '';
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? '' : toPbDate(d);
}

// formatters are expensive to create: once per module, not per item
const dayFormat = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	year: 'numeric'
});
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export function formatTime(pbDate: string): string {
	return timeFormat.format(parsePbDate(pbDate));
}

/** "Heute", "Gestern" or e.g. "Montag, 26. Oktober 2026" for a `dayKey` */
export function dayLabel(key: string, now = new Date()): string {
	const [y, m, d] = key.split('-').map(Number);
	const day = new Date(y, m - 1, d);
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
	if (diff === 0) return 'Heute';
	if (diff === 1) return 'Gestern';
	return dayFormat.format(day);
}

export type DayGroup = { key: string; label: string; items: Activity[] };

/** Groups an already sorted list by local calendar day, keeping the order. */
export function groupByDay(list: Activity[], now = new Date()): DayGroup[] {
	const groups: DayGroup[] = [];
	for (const a of list) {
		const key = dayKey(a.occurred_at);
		const last = groups[groups.length - 1];
		if (last?.key === key) last.items.push(a);
		else groups.push({ key, label: dayLabel(key, now), items: [a] });
	}
	return groups;
}

/**
 * PocketBase stores uploads as `<sanitised name>_<10 random chars>.<ext>`; show the name
 * without the random suffix.
 */
export function displayFileName(stored: string): string {
	return stored.replace(/_[a-z0-9]{10}(\.[^.]*)?$/i, '$1');
}

const sizeFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
	return `${sizeFormat.format(bytes / 1024 / 1024)} MB`;
}

/**
 * Link typed into the editor's link field -> href, or null if not allowed. Bare domains get
 * https://, bare e-mail addresses mailto:; any other scheme (javascript:, data:, …) is
 * refused (the display sanitiser would drop it anyway).
 */
export function normalizeLink(input: string): string | null {
	const v = input.trim();
	if (!v || /\s/.test(v)) return null;
	if (/^(?:https?:\/\/|mailto:|tel:)/i.test(v)) return v;
	if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)) return null;
	if (/^[^@/]+@[^@/]+\.[a-z]{2,}$/i.test(v)) return `mailto:${v}`;
	return `https://${v}`;
}

/** file types PocketBase can make thumbnails of */
export function isImageFile(name: string): boolean {
	return /\.(jpe?g|png|gif|webp)$/i.test(name);
}
