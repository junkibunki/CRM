import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SORT,
	NO_COMPANY,
	filterContacts,
	groupByCompany,
	sortContacts,
	toggleSort
} from './contact-table.js';

const companies: Record<string, string> = { a: 'Acme', b: 'Bauer GmbH', z: 'Ärzte AG', d: 'Acme' };
const companyName = (id: string) => companies[id] ?? '';

let n = 0;
function contact(first: string, last: string, company = '', extra: Partial<Record<'position' | 'email' | 'phone', string>> = {}) {
	return { id: `c${++n}`, first_name: first, last_name: last, company, position: '', email: '', phone: '', ...extra };
}

const anna = contact('Anna', 'Zeller', 'b', { position: 'CEO', email: 'anna@bauer.de' });
const bernd = contact('Bernd', 'Albers', 'b', { phone: '0711 1' });
const carla = contact('Carla', 'Meier', 'a', { position: 'Einkauf' });
const dieter = contact('Dieter', 'Ober', '');
const emil = contact('Emil', 'Ude', 'gone');
const frida = contact('Frida', 'Klein', 'z');
const all = [anna, bernd, carla, dieter, emil, frida];
const names = (list: { first_name: string }[]) => list.map((c) => c.first_name);

describe('sortContacts', () => {
	it('sorts by company by default, contacts by last name inside', () => {
		expect(DEFAULT_SORT).toEqual({ key: 'company', dir: 'asc' });
		// Acme < Ärzte (Umlaut wie a) < Bauer; ohne/unbekanntes Unternehmen zuletzt
		expect(names(sortContacts(all, DEFAULT_SORT, companyName))).toEqual([
			'Carla', 'Frida', 'Bernd', 'Anna', 'Dieter', 'Emil'
		]);
	});

	it('keeps contacts without company last when descending', () => {
		expect(names(sortContacts(all, { key: 'company', dir: 'desc' }, companyName))).toEqual([
			'Bernd', 'Anna', 'Frida', 'Carla', 'Dieter', 'Emil'
		]);
	});

	it('sorts by name (last name, first name) both ways', () => {
		expect(names(sortContacts(all, { key: 'name', dir: 'asc' }, companyName))).toEqual([
			'Bernd', 'Frida', 'Carla', 'Dieter', 'Emil', 'Anna'
		]);
		expect(names(sortContacts(all, { key: 'name', dir: 'desc' }, companyName))).toEqual([
			'Anna', 'Emil', 'Dieter', 'Carla', 'Frida', 'Bernd'
		]);
	});

	it('puts empty values last in text columns, ties by name', () => {
		expect(names(sortContacts(all, { key: 'position', dir: 'asc' }, companyName))).toEqual([
			'Anna', 'Carla', 'Bernd', 'Frida', 'Dieter', 'Emil'
		]);
		expect(names(sortContacts(all, { key: 'position', dir: 'desc' }, companyName)).slice(0, 2)).toEqual([
			'Carla', 'Anna'
		]);
	});

	it('does not mutate the input', () => {
		const copy = [...all];
		sortContacts(all, { key: 'name', dir: 'desc' }, companyName);
		expect(all).toEqual(copy);
	});

	it('keeps two companies with the same name in separate blocks', () => {
		const x1 = contact('X', 'A', 'a');
		const y = contact('Y', 'B', 'd');
		const x2 = contact('X', 'C', 'a');
		const sorted = sortContacts([x1, y, x2], DEFAULT_SORT, companyName);
		const groups = groupByCompany(sorted, companyName);
		expect(groups.map((g) => [g.key, g.rows.length])).toEqual([
			['a', 2],
			['d', 1]
		]);
	});
});

describe('groupByCompany', () => {
	it('clusters by company and collects missing ones under "Ohne Unternehmen"', () => {
		const groups = groupByCompany(sortContacts(all, DEFAULT_SORT, companyName), companyName);
		expect(groups.map((g) => [g.label, names(g.rows)])).toEqual([
			['Acme', ['Carla']],
			['Ärzte AG', ['Frida']],
			['Bauer GmbH', ['Bernd', 'Anna']],
			['Ohne Unternehmen', ['Dieter', 'Emil']]
		]);
		expect(groups.at(-1)?.key).toBe(NO_COMPANY);
	});

	it('returns no groups for an empty list', () => {
		expect(groupByCompany([], companyName)).toEqual([]);
	});
});

describe('filterContacts', () => {
	it('returns everything without query and company', () => {
		expect(filterContacts(all, { query: '  ', company: '' }, companyName)).toHaveLength(all.length);
	});

	it('filters by company id', () => {
		expect(names(filterContacts(all, { query: '', company: 'b' }, companyName))).toEqual(['Anna', 'Bernd']);
	});

	it('filters contacts without a (known) company', () => {
		expect(names(filterContacts(all, { query: '', company: NO_COMPANY }, companyName))).toEqual([
			'Dieter', 'Emil'
		]);
	});

	it('searches name, company, position, email and phone case-insensitively', () => {
		const q = (query: string) => names(filterContacts(all, { query, company: '' }, companyName));
		expect(q('ANNA Z')).toEqual(['Anna']);
		expect(q('acme')).toEqual(['Carla']);
		expect(q('einkauf')).toEqual(['Carla']);
		expect(q('@bauer')).toEqual(['Anna']);
		expect(q('0711')).toEqual(['Bernd']);
	});

	it('combines search and company filter', () => {
		expect(names(filterContacts(all, { query: 'anna', company: 'a' }, companyName))).toEqual([]);
		expect(names(filterContacts(all, { query: 'bernd', company: 'b' }, companyName))).toEqual(['Bernd']);
	});
});

describe('toggleSort', () => {
	it('flips the direction on the same column and starts ascending on a new one', () => {
		expect(toggleSort(DEFAULT_SORT, 'company')).toEqual({ key: 'company', dir: 'desc' });
		expect(toggleSort({ key: 'company', dir: 'desc' }, 'company')).toEqual({ key: 'company', dir: 'asc' });
		expect(toggleSort({ key: 'company', dir: 'desc' }, 'email')).toEqual({ key: 'email', dir: 'asc' });
	});
});
