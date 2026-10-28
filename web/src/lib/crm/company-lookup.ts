// F10: company data suggested from the company website. The server route
// (pocketbase/pb_hooks/company-lookup.pb.js) fetches and extracts; this is the client side:
// which domain to ask for, the call, error texts and which suggestions to show.
import { ClientResponseError } from 'pocketbase';
import { pb } from '#lib/pb.js';

export type CompanyLookup = {
	name: string;
	address: string;
	phone: string;
	email: string;
	website: string;
	/** page the data came from (impressum or home page) */
	source: string;
	cached?: boolean;
};

export type LookupField = 'name' | 'website' | 'phone' | 'email' | 'address';
export const LOOKUP_FIELDS: readonly LookupField[] = ['name', 'website', 'phone', 'email', 'address'];

/**
 * Website field → domain for the lookup: host without `www.`, IDN as punycode
 * (`https://www.Müller.de/x` → `xn--mller-kva.de`). '' when there is no usable public
 * hostname (empty, IP address, single label); the server checks again.
 */
export function lookupDomain(website: string): string {
	const s = website.trim();
	if (!s) return '';
	try {
		const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(s) ? s : `https://${s}`);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
		if (u.username || u.password) return ''; // also "mailto:a@b.de" read as https://mailto:a@b.de
		const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
		const labels = host.split('.');
		if (labels.length < 2 || !/^[a-z\d.-]+$/.test(host)) return '';
		if (!/^(?:[a-z]{2,}|xn--[a-z\d-]+)$/.test(labels[labels.length - 1])) return '';
		return host;
	} catch {
		return '';
	}
}

export function fetchCompanyLookup(domain: string): Promise<CompanyLookup> {
	return pb.send<CompanyLookup>('/api/crm/company-lookup', {
		method: 'GET',
		query: { domain },
		// two dialogs may look up at the same time; never auto-cancel one for the other
		requestKey: null
	});
}

/** error → German text for the dialog (the server already answers in German) */
export function lookupErrorMessage(err: unknown): string {
	if (err instanceof ClientResponseError) {
		if (err.status === 0) return 'Keine Verbindung zum Server.';
		if (err.status === 401 || err.status === 403) return 'Bitte erneut anmelden.';
		if (err.status === 429) return 'Zu viele Abfragen – bitte eine Minute warten.';
		const message = (err.response as { message?: string } | undefined)?.message;
		if (message && err.status >= 400 && err.status < 500) return message;
		if (message && err.status === 502) return message;
	}
	return 'Die Website-Daten konnten nicht geladen werden.';
}

function same(field: LookupField, a: string, b: string): boolean {
	const norm = (s: string) => {
		let v = s.trim().replace(/\s+/g, ' ').toLowerCase();
		if (field === 'website') v = v.replace(/\/+$/, '');
		if (field === 'phone') v = v.replace(/[^\d+]/g, '');
		return v;
	};
	return norm(a) === norm(b);
}

/** suggestions worth a chip: found (non-empty) and different from what the field holds */
export function lookupChips(
	result: CompanyLookup | null,
	form: Record<LookupField, string>
): Partial<Record<LookupField, string>> {
	const chips: Partial<Record<LookupField, string>> = {};
	if (!result) return chips;
	for (const field of LOOKUP_FIELDS) {
		const value = (result[field] ?? '').trim();
		if (value && !same(field, value, form[field] ?? '')) chips[field] = value;
	}
	return chips;
}

/** true when the lookup found none of the fields */
export function lookupEmpty(result: CompanyLookup): boolean {
	return !result.name && !result.address && !result.phone && !result.email;
}
