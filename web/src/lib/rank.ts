import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

type Ranked = { id: string; rank: string };

// Plain code-point compare: matches SQLite's default BINARY collation for `sort=rank`.
export function byRank(a: Ranked, b: Ranked) {
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Key between two neighbours, or null when they collide (concurrent inserts) and the list needs new keys. */
export function rankBetween(before: string | null, after: string | null): string | null {
	try {
		return generateKeyBetween(before, after);
	} catch {
		return null;
	}
}

/** Fresh, evenly spaced keys for a whole list. */
export function freshRanks(n: number): string[] {
	return generateNKeysBetween(null, null, n);
}

/** Inserts `item` at its sorted position (binary search). */
export function insertSorted<T extends Ranked>(list: T[], item: T) {
	let lo = 0;
	let hi = list.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (byRank(list[mid], item) < 0) lo = mid + 1;
		else hi = mid;
	}
	list.splice(lo, 0, item);
}
