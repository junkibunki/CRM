import { contactName, type Contact } from '#lib/types.js';

/** Filter, Sortierung und Gruppierung der Kontakttabelle (rein, ohne Svelte). */

export type SortKey = 'name' | 'company' | 'position' | 'email' | 'phone';
export type SortDir = 'asc' | 'desc';
export type Sort = { key: SortKey; dir: SortDir };

/** Standard: nach Unternehmen geclustert. */
export const DEFAULT_SORT: Sort = { key: 'company', dir: 'asc' };

/** Filterwert für Kontakte ohne (auffindbares) Unternehmen; `''` heißt „alle". */
export const NO_COMPANY = '-';

type Row = Pick<Contact, 'id' | 'first_name' | 'last_name' | 'company' | 'position' | 'email' | 'phone'>;
type NameOf = (companyId: string) => string;

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/** Leere Werte stehen hinten, egal in welche Richtung (`name` absteigend negiert das Ganze). */
function cmpText(a: string, b: string, dir: SortDir) {
	if (!a !== !b) return a ? -1 : 1;
	const r = collator.compare(a, b);
	return dir === 'asc' ? r : -r;
}

function cmpName(a: Row, b: Row) {
	return (
		cmpText(a.last_name, b.last_name, 'asc') ||
		cmpText(a.first_name, b.first_name, 'asc') ||
		collator.compare(a.id, b.id)
	);
}

/** Nimmt der Klick auf eine Spalte: gleiche Spalte dreht die Richtung, neue beginnt aufsteigend. */
export function toggleSort(current: Sort, key: SortKey): Sort {
	return current.key === key
		? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
		: { key, dir: 'asc' };
}

export function filterContacts<T extends Row>(
	list: readonly T[],
	{ query, company }: { query: string; company: string },
	companyName: NameOf
): T[] {
	const q = query.trim().toLowerCase();
	return list.filter((c) => {
		const name = companyName(c.company);
		if (company === NO_COMPANY ? name !== '' : company && c.company !== company) return false;
		if (!q) return true;
		return [contactName(c), name, c.position, c.email, c.phone].some((v) =>
			v?.toLowerCase().includes(q)
		);
	});
}

/** Sortiert eine Kopie. Bei Gleichstand nach Nachname, Vorname. */
export function sortContacts<T extends Row>(list: readonly T[], sort: Sort, companyName: NameOf): T[] {
	const { key, dir } = sort;
	return [...list].sort((a, b) => {
		if (key === 'name') {
			const r = cmpName(a, b);
			return dir === 'asc' ? r : -r;
		}
		if (key === 'company') {
			const na = companyName(a.company);
			const nb = companyName(b.company);
			// Bei gleichem Namen nach id trennen, damit jedes Unternehmen ein Block bleibt.
			return cmpText(na, nb, dir) || (na ? collator.compare(a.company, b.company) : 0) || cmpName(a, b);
		}
		return cmpText(a[key] ?? '', b[key] ?? '', dir) || cmpName(a, b);
	});
}

export type CompanyGroup<T> = { key: string; label: string; rows: T[] };

/**
 * Fasst eine nach Unternehmen sortierte Liste in Blöcke zusammen. Kontakte, deren
 * Unternehmen keinen Namen hat (keins oder nicht gefunden), landen in „Ohne Unternehmen".
 */
export function groupByCompany<T extends Row>(sorted: readonly T[], companyName: NameOf): CompanyGroup<T>[] {
	const groups: CompanyGroup<T>[] = [];
	for (const c of sorted) {
		const label = companyName(c.company);
		const key = label ? c.company : NO_COMPANY;
		const last = groups.at(-1);
		if (last?.key === key) last.rows.push(c);
		else groups.push({ key, label: label || 'Ohne Unternehmen', rows: [c] });
	}
	return groups;
}
