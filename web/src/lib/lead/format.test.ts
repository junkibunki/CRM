import { describe, expect, it } from 'vitest';
import type { Contact } from '../types';
import {
	companyContactCount,
	formatDateTime,
	formatDay,
	leadContacts,
	telHref,
	websiteHref,
	websiteLabel
} from './format';

describe('formatDay', () => {
	it('formats UTC midnight as that day, whatever the local time zone', () => {
		expect(formatDay('2026-03-01 00:00:00.000Z')).toBe('01.03.2026');
	});
	it('returns an empty string for no or an invalid date', () => {
		expect(formatDay('')).toBe('');
		expect(formatDay('kaputt')).toBe('');
	});
});

describe('formatDateTime', () => {
	it('includes the date and a time', () => {
		const s = formatDateTime('2026-03-01 12:34:56.000Z');
		expect(s).toContain('2026');
		expect(s).toMatch(/\d{2}:\d{2}/);
	});
	it('returns an empty string for no date', () => {
		expect(formatDateTime('')).toBe('');
	});
});

describe('websiteHref / websiteLabel', () => {
	it('adds https:// when the protocol is missing', () => {
		expect(websiteHref('example.com')).toBe('https://example.com');
		expect(websiteHref(' http://example.com ')).toBe('http://example.com');
		expect(websiteHref('HTTPS://Example.com/x')).toBe('HTTPS://Example.com/x');
		expect(websiteHref('')).toBe('');
	});
	it('shows the address without protocol and trailing slash', () => {
		expect(websiteLabel('https://www.example.com/')).toBe('www.example.com');
		expect(websiteLabel('example.com/kontakt')).toBe('example.com/kontakt');
	});
});

describe('telHref', () => {
	it('keeps digits and a leading plus only', () => {
		expect(telHref('+49 (0) 30 / 123-45')).toBe('tel:+4903012345');
		expect(telHref('030 1234 5678')).toBe('tel:03012345678');
		expect(telHref('0049+30')).toBe('tel:004930');
	});
	it('returns an empty string when nothing dialable is left', () => {
		expect(telHref('')).toBe('');
		expect(telHref('siehe Website')).toBe('');
	});
});

describe('leadContacts', () => {
	const c = (id: string) => ({ id, last_name: id }) as Contact;
	const all = new Map([
		['a', c('a')],
		['b', c('b')]
	]);
	it('keeps the order of the lead and skips unknown ids', () => {
		expect(leadContacts(['b', 'x', 'a'], (id) => all.get(id)).map((x) => x.id)).toEqual(['b', 'a']);
	});
});

describe('companyContactCount', () => {
	it('counts the contacts of one company', () => {
		const list = [{ company: 'co' }, { company: 'co' }, { company: 'other' }, { company: '' }];
		expect(companyContactCount('co', list)).toBe(2);
		expect(companyContactCount('none', list)).toBe(0);
		expect(companyContactCount('', list)).toBe(0); // contacts without company don't count
	});
});
