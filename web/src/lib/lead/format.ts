import type { Contact } from '../types';

// built once: Intl formatters are expensive (see kanban.md, Performance)
// dates like expected_close are stored as UTC midnight: format in UTC so the day never shifts
const day = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function parse(pbDate: string) {
	const d = new Date(pbDate.replace(' ', 'T'));
	return Number.isNaN(d.getTime()) ? null : d;
}

/** PocketBase date (UTC midnight) -> "12.03.2026"; '' for no or invalid date */
export function formatDay(pbDate: string) {
	const d = pbDate ? parse(pbDate) : null;
	return d ? day.format(d) : '';
}

/** PocketBase timestamp -> local date and time; '' for no or invalid date */
export function formatDateTime(pbDate: string) {
	const d = pbDate ? parse(pbDate) : null;
	return d ? dateTime.format(d) : '';
}

/** Link target for a website as typed ("example.com" -> "https://example.com"). */
export function websiteHref(url: string) {
	const u = url.trim();
	if (!u) return '';
	return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Website without protocol and trailing slash, for display. */
export function websiteLabel(url: string) {
	return url
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/\/$/, '');
}

/** tel: target: digits and a leading +, everything else (spaces, slashes, dashes) dropped. */
export function telHref(phone: string) {
	const p = phone.trim();
	if (!p) return '';
	const digits = p.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
	return digits ? `tel:${digits}` : '';
}

/** The lead's contacts in the lead's order; ids not (yet) loaded are skipped. */
export function leadContacts(ids: string[], get: (id: string) => Contact | undefined): Contact[] {
	return ids.map(get).filter((c): c is Contact => !!c);
}

/** Number of contacts that belong to a company. */
export function companyContactCount(companyId: string, all: Pick<Contact, 'company'>[]) {
	if (!companyId) return 0;
	let n = 0;
	for (const c of all) if (c.company === companyId) n++;
	return n;
}
