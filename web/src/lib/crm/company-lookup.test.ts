import { ClientResponseError } from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/pb.js', () => ({ pb: { send: vi.fn() } }));

import { pb } from '#lib/pb.js';
import {
	fetchCompanyLookup,
	lookupChips,
	lookupDomain,
	lookupEmpty,
	lookupErrorMessage,
	type CompanyLookup
} from './company-lookup';

const apiError = (status: number, message = '') =>
	new ClientResponseError({ url: '/api/crm/company-lookup', status, response: { message, status, data: {} } });

describe('lookupDomain', () => {
	it.each([
		['https://www.firma.de', 'firma.de'],
		['https://firma.de/kontakt?x=1', 'firma.de'],
		['firma.de', 'firma.de'],
		['  WWW.Firma.DE  ', 'firma.de'],
		['http://shop.firma.co.uk/', 'shop.firma.co.uk'],
		['https://müller-bau.de', 'xn--mller-bau-q9a.de']
	])('%s → %s', (website, domain) => {
		expect(lookupDomain(website)).toBe(domain);
	});

	it.each(['', '   ', 'https://192.168.0.1', 'https://[::1]/', 'localhost', 'https://intranet/', 'ftp://firma.de', 'mailto:a@b.de', 'kein host'])(
		'%j → no domain',
		(website) => {
			expect(lookupDomain(website)).toBe('');
		}
	);
});

describe('fetchCompanyLookup', () => {
	beforeEach(() => vi.mocked(pb.send).mockReset());

	it('asks the server route for the domain, without auto-cancel', async () => {
		const result: CompanyLookup = { name: 'Muster GmbH', address: '', phone: '', email: '', website: 'https://muster.de', source: 'https://muster.de/impressum' };
		vi.mocked(pb.send).mockResolvedValue(result);
		await expect(fetchCompanyLookup('muster.de')).resolves.toEqual(result);
		expect(pb.send).toHaveBeenCalledWith('/api/crm/company-lookup', { method: 'GET', query: { domain: 'muster.de' }, requestKey: null });
	});
});

describe('lookupErrorMessage', () => {
	it('passes on the server text for refused and unreachable sites', () => {
		expect(lookupErrorMessage(apiError(400, 'Nur Seiten von muster.de werden abgerufen.'))).toBe('Nur Seiten von muster.de werden abgerufen.');
		expect(lookupErrorMessage(apiError(502, 'Die Website ist nicht erreichbar.'))).toBe('Die Website ist nicht erreichbar.');
	});

	it('has own texts for rate limit, session and network errors', () => {
		expect(lookupErrorMessage(apiError(429, 'Too Many Requests.'))).toMatch(/Zu viele Abfragen/);
		expect(lookupErrorMessage(apiError(401, 'The request requires valid record authorization token.'))).toBe('Bitte erneut anmelden.');
		expect(lookupErrorMessage(apiError(0))).toBe('Keine Verbindung zum Server.');
		expect(lookupErrorMessage(apiError(500, 'Something went wrong'))).toBe('Die Website-Daten konnten nicht geladen werden.');
		expect(lookupErrorMessage(new Error('x'))).toBe('Die Website-Daten konnten nicht geladen werden.');
	});
});

describe('lookupChips', () => {
	const result: CompanyLookup = {
		name: 'Muster Maschinenbau GmbH',
		address: 'Hauptweg 1, 12345 Ort',
		phone: '+49 30 123456',
		email: 'info@muster.de',
		website: 'https://www.muster.de',
		source: 'https://www.muster.de/impressum'
	};
	const form = { name: '', website: '', phone: '', email: '', address: '' };

	it('offers every found field for an empty form', () => {
		expect(lookupChips(result, form)).toEqual({
			name: 'Muster Maschinenbau GmbH',
			website: 'https://www.muster.de',
			phone: '+49 30 123456',
			email: 'info@muster.de',
			address: 'Hauptweg 1, 12345 Ort'
		});
	});

	it('offers a different value for a filled field (replaced only on click)', () => {
		expect(lookupChips(result, { ...form, name: 'Mueller Maschinenbau' }).name).toBe('Muster Maschinenbau GmbH');
	});

	it('hides suggestions that equal the field (case, spacing, slash, phone formatting)', () => {
		const same = { name: 'muster maschinenbau  GmbH', website: 'https://www.muster.de/', phone: '+49 (30) 123-456', email: 'INFO@muster.de', address: 'Hauptweg 1, 12345 Ort' };
		expect(lookupChips(result, same)).toEqual({});
	});

	it('skips empty suggestions and a missing result', () => {
		expect(lookupChips({ ...result, phone: '', email: ' ' }, form)).not.toHaveProperty('phone');
		expect(lookupChips({ ...result, phone: '', email: ' ' }, form)).not.toHaveProperty('email');
		expect(lookupChips(null, form)).toEqual({});
	});

	it('lookupEmpty: nothing but the website found', () => {
		expect(lookupEmpty({ ...result, name: '', address: '', phone: '', email: '' })).toBe(true);
		expect(lookupEmpty(result)).toBe(false);
	});
});
