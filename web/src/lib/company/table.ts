import { websiteLabel } from '../lead/format';
import type { Company } from '../types';

/** Filter and sorting of the company table (rein, ohne Svelte). */

export type CompanySortKey = 'name' | 'website' | 'email' | 'phone' | 'contacts' | 'leads';
export type SortDir = 'asc' | 'desc';
export type CompanySort = { key: CompanySortKey; dir: SortDir };

export const DEFAULT_COMPANY_SORT: CompanySort = { key: 'name', dir: 'asc' };

/** Count columns: a first click shows the largest numbers on top. */
const NUMERIC: ReadonlySet<CompanySortKey> = new Set(['contacts', 'leads']);

type Row = Pick<Company, 'id' | 'name' | 'website' | 'email' | 'phone'>;
export type Counts = { contacts: ReadonlyMap<string, number>; leads: ReadonlyMap<string, number> };

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Empty values stay at the bottom, whichever way it is sorted. */
function cmpText(a: string, b: string, dir: SortDir) {
	if (!a !== !b) return a ? -1 : 1;
	const r = collator.compare(a, b);
	return dir === 'asc' ? r : -r;
}

const byName = (a: Row, b: Row) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id);

/** Same column: other direction. New column: text A→Z, counts largest first. */
export function toggleCompanySort(current: CompanySort, key: CompanySortKey): CompanySort {
	if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
	return { key, dir: NUMERIC.has(key) ? 'desc' : 'asc' };
}

export function filterCompanies<T extends Row>(list: readonly T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((c) => [c.name, c.email, c.website, c.phone].some((v) => v?.toLowerCase().includes(q)));
}

/** Sorts a copy. Ties: by name. */
export function sortCompanies<T extends Row>(list: readonly T[], sort: CompanySort, counts: Counts): T[] {
	const { key, dir } = sort;
	return [...list].sort((a, b) => {
		if (key === 'name') {
			const r = byName(a, b);
			return dir === 'asc' ? r : -r;
		}
		if (key === 'contacts' || key === 'leads') {
			const m = counts[key];
			const r = (m.get(a.id) ?? 0) - (m.get(b.id) ?? 0);
			return (dir === 'asc' ? r : -r) || byName(a, b);
		}
		const va = key === 'website' ? websiteLabel(a.website ?? '') : (a[key] ?? '').trim();
		const vb = key === 'website' ? websiteLabel(b.website ?? '') : (b[key] ?? '').trim();
		return cmpText(va, vb, dir) || byName(a, b);
	});
}
