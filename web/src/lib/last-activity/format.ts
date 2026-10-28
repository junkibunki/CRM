// Last activity of a lead (F4): pure helpers, unit-tested.
import type { ActivityType } from '../activities/types';

/** One row of the view `lead_last_activity` (migration 1793190002), few fields. */
export type LastActivity = {
	id: string;
	lead: string;
	type: ActivityType;
	subject: string;
	/** PocketBase date string: when it happened */
	occurred_at: string;
	created: string;
	/** plain-text excerpt of the body (`body:excerpt(…)`), not HTML */
	body: string;
};

/** `fields=` for the view query and the activities subscription (excerpt instead of the HTML) */
export const LAST_ACTIVITY_FIELDS = 'id,lead,type,subject,occurred_at,created,body:excerpt(120,true)';

/** a happened after b: by occurred_at, then entry time, then id (same order as the timeline) */
export function isNewer(a: Pick<LastActivity, 'occurred_at' | 'created' | 'id'>, b: typeof a): boolean {
	if (a.occurred_at !== b.occurred_at) return a.occurred_at > b.occurred_at;
	if (a.created !== b.created) return a.created > b.created;
	return a.id > b.id;
}

/** "the first line": the subject, else the start of the text */
export function firstLine(a: Pick<LastActivity, 'subject' | 'body'>): string {
	return a.subject.trim() || a.body.replace(/\s+/g, ' ').trim();
}

// built once: Intl formatters are expensive (kanban.md, Performance)
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

/**
 * Local calendar days between the activity and `now` as "heute", "gestern", "vor 3 Tagen",
 * "vor 2 Wochen", "vor 3 Monaten", "vor 1 Jahr" (future dates: "morgen", "in 3 Tagen").
 */
export function relativeDay(pbDate: string, now: Date): string {
	const d = new Date(pbDate.replace(' ', 'T'));
	if (Number.isNaN(d.getTime())) return '';
	const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
	const abs = Math.abs(days);
	if (abs < 14) return rtf.format(days, 'day');
	if (abs < 60) return rtf.format(Math.trunc(days / 7), 'week');
	if (abs < 365) return rtf.format(Math.trunc(days / 30), 'month');
	return rtf.format(Math.trunc(days / 365), 'year');
}
