import { describe, expect, it } from 'vitest';
import {
	DEFAULT_COMPANY_SORT,
	filterCompanies,
	sortCompanies,
	toggleCompanySort,
	type CompanySort,
	type Counts
} from './table';

type Row = { id: string; name: string; website: string; email: string; phone: string };
const row = (id: string, name: string, extra: Partial<Row> = {}): Row => ({
	id,
	name,
	website: '',
	email: '',
	phone: '',
	...extra
});

const list = [
	row('a', 'Zeta GmbH', { website: 'https://alpha.de', email: 'info@zeta.de', phone: '030 1' }),
	row('b', 'Ärzte AG', { website: 'beta.de', email: '' }),
	row('c', 'Beta KG', { website: '', email: 'kontakt@beta.de', phone: '040 2' }),
	row('d', 'firma 10', {}),
	row('e', 'Firma 9', {})
];
const counts: Counts = {
	contacts: new Map([
		['a', 3],
		['c', 1]
	]),
	leads: new Map([
		['b', 2],
		['c', 2],
		['e', 5]
	])
};

const ids = (sort: CompanySort) => sortCompanies(list, sort, counts).map((r) => r.id);

describe('toggleCompanySort', () => {
	it('same column flips the direction', () => {
		expect(toggleCompanySort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
		expect(toggleCompanySort({ key: 'leads', dir: 'desc' }, 'leads')).toEqual({ key: 'leads', dir: 'asc' });
	});

	it('a new text column starts A→Z, a count column with the largest first', () => {
		expect(toggleCompanySort(DEFAULT_COMPANY_SORT, 'email')).toEqual({ key: 'email', dir: 'asc' });
		expect(toggleCompanySort(DEFAULT_COMPANY_SORT, 'leads')).toEqual({ key: 'leads', dir: 'desc' });
		expect(toggleCompanySort(DEFAULT_COMPANY_SORT, 'contacts')).toEqual({ key: 'contacts', dir: 'desc' });
	});
});

describe('sortCompanies', () => {
	it('by name: German collation (Ä with A), numbers numerically, case ignored', () => {
		expect(ids({ key: 'name', dir: 'asc' })).toEqual(['b', 'c', 'e', 'd', 'a']);
		expect(ids({ key: 'name', dir: 'desc' })).toEqual(['a', 'd', 'e', 'c', 'b']);
	});

	it('by active leads: missing = 0, ties by name', () => {
		expect(ids({ key: 'leads', dir: 'desc' })).toEqual(['e', 'b', 'c', 'd', 'a']);
		expect(ids({ key: 'leads', dir: 'asc' })).toEqual(['d', 'a', 'b', 'c', 'e']);
	});

	it('by contacts', () => {
		expect(ids({ key: 'contacts', dir: 'desc' })).toEqual(['a', 'c', 'b', 'e', 'd']);
	});

	it('text columns: empty values at the bottom in both directions', () => {
		expect(ids({ key: 'email', dir: 'asc' })).toEqual(['a', 'c', 'b', 'e', 'd']);
		expect(ids({ key: 'email', dir: 'desc' })).toEqual(['c', 'a', 'b', 'e', 'd']);
		expect(ids({ key: 'phone', dir: 'desc' })).toEqual(['c', 'a', 'b', 'e', 'd']);
	});

	it('website ignores the protocol', () => {
		// alpha.de (a) before beta.de (b), although "https://…" would sort after "beta"
		expect(ids({ key: 'website', dir: 'asc' }).slice(0, 2)).toEqual(['a', 'b']);
	});

	it('does not touch the input list', () => {
		const before = list.map((r) => r.id);
		sortCompanies(list, { key: 'leads', dir: 'desc' }, counts);
		expect(list.map((r) => r.id)).toEqual(before);
	});
});

describe('filterCompanies', () => {
	it('searches name, e-mail, website and phone, case-insensitive', () => {
		expect(filterCompanies(list, 'BETA').map((r) => r.id)).toEqual(['b', 'c']);
		expect(filterCompanies(list, '040').map((r) => r.id)).toEqual(['c']);
		expect(filterCompanies(list, '  ').length).toBe(list.length);
	});
});
