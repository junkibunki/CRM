// View model of the lead quick view (LeadPreview.svelte): pure, so it is unit-tested.
import {
	COLUMN_COLORS,
	contactName,
	toDateInput,
	type BoardColumn,
	type Contact,
	type Lead
} from '../types';

/** Name lookups, injected so tests don't need the live collections. */
export type PreviewLookups = {
	company: (id: string) => string;
	contact: (id: string) => Pick<Contact, 'first_name' | 'last_name' | 'position'> | undefined;
	user: (id: string) => string;
};

export type PreviewData = {
	lead: Lead;
	/** the stage whose list holds the lead (that is what the board shows), null if unknown */
	column: BoardColumn | null;
	/** full Tailwind class of the stage's colour dot */
	dot: string;
	company: string;
	contacts: { id: string; name: string; position: string }[];
	/** expected close as YYYY-MM-DD, '' if none */
	close: string;
	overdue: boolean;
	owner: string;
};

// shared formatters: building Intl formatters per render is measurably slow
// expected_close is stored as UTC midnight: format in UTC so the day never shifts
const day = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'UTC'
});
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

/** Today as YYYY-MM-DD in local time (toISOString would be UTC: wrong between 0 and 2 am). */
export function localDate(d = new Date()) {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD -> 31.12.2026 */
export function formatDay(date: string) {
	return date ? day.format(new Date(date)) : '';
}

/** PocketBase timestamp (`2026-01-01 10:00:00.000Z`) -> local date and time */
export function formatCreated(created: string) {
	if (!created) return '';
	const d = new Date(created.replace(' ', 'T'));
	return isNaN(d.getTime()) ? '' : dateTime.format(d);
}

/** The lead with `id` and the stage list it sits in, or null if it is not (any longer) there. */
export function locateLead(leads: Record<string, Lead[]>, id: string) {
	for (const [column, list] of Object.entries(leads)) {
		const lead = list.find((l) => l.id === id);
		if (lead) return { lead, column };
	}
	return null;
}

/**
 * Everything the quick view shows for lead `id`, read from the board state; null when the
 * lead is no longer on the board (deleted, or its stage was deleted).
 */
export function previewData(
	board: { leads: Record<string, Lead[]>; columns: BoardColumn[] },
	id: string,
	lookups: PreviewLookups,
	today: string
): PreviewData | null {
	const loc = locateLead(board.leads, id);
	if (!loc) return null;
	const { lead } = loc;
	const column = board.columns.find((c) => c.id === loc.column) ?? null;
	const close = toDateInput(lead.expected_close);
	const contacts = [];
	for (const cid of lead.contacts ?? []) {
		const c = lookups.contact(cid);
		if (c) contacts.push({ id: cid, name: contactName(c), position: c.position ?? '' });
	}
	return {
		lead,
		column,
		dot: COLUMN_COLORS[column?.color || 'gray']?.dot ?? COLUMN_COLORS.gray.dot,
		company: lead.company ? lookups.company(lead.company) : '',
		contacts,
		close,
		overdue: close !== '' && close < today,
		owner: lead.owner ? lookups.user(lead.owner) : ''
	};
}

/**
 * What the quick view has to do: nothing while closed, show the data, or — the lead
 * vanished while it was open — close with a short notice.
 */
export function previewStatus(open: boolean, id: string | null, data: PreviewData | null) {
	if (!open || !id) return 'idle' as const;
	return data ? ('show' as const) : ('gone' as const);
}
