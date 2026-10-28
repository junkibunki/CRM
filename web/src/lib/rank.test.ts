// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { byRank, freshRanks, insertSorted, rankBetween } from './rank';

describe('byRank', () => {
	it('compares by code point, like SQLite BINARY (uppercase before lowercase)', () => {
		expect(byRank({ id: 'a', rank: 'Zz' }, { id: 'b', rank: 'a0' })).toBeLessThan(0);
		expect(byRank({ id: 'a', rank: 'a1' }, { id: 'b', rank: 'a0' })).toBeGreaterThan(0);
	});

	it('breaks ties by id', () => {
		expect(byRank({ id: 'a', rank: 'a0' }, { id: 'b', rank: 'a0' })).toBeLessThan(0);
		expect(byRank({ id: 'b', rank: 'a0' }, { id: 'b', rank: 'a0' })).toBe(0);
	});
});

describe('rankBetween', () => {
	it('returns a key strictly between the neighbours', () => {
		const k = rankBetween('a0', 'a1')!;
		expect(k > 'a0' && k < 'a1').toBe(true);
	});

	it('handles open ends', () => {
		expect(rankBetween(null, 'a0')! < 'a0').toBe(true);
		expect(rankBetween('a5', null)! > 'a5').toBe(true);
		expect(rankBetween(null, null)).toBeTypeOf('string');
	});

	it('returns null for colliding (equal) neighbours instead of throwing', () => {
		expect(rankBetween('a0', 'a0')).toBeNull();
	});

	it('tolerates swapped neighbours (fractional-indexing 4 returns a key between them)', () => {
		const k = rankBetween('a1', 'a0')!;
		expect(k > 'a0' && k < 'a1').toBe(true);
	});
});

describe('freshRanks', () => {
	it('gives n increasing, distinct keys', () => {
		const keys = freshRanks(5);
		expect(keys).toHaveLength(5);
		expect([...keys].sort()).toEqual(keys);
		expect(new Set(keys).size).toBe(5);
	});
});

describe('insertSorted', () => {
	it('inserts at the sorted position', () => {
		const list = [
			{ id: '1', rank: 'a0' },
			{ id: '2', rank: 'a2' }
		];
		insertSorted(list, { id: '3', rank: 'a1' });
		insertSorted(list, { id: '4', rank: 'a3' });
		insertSorted(list, { id: '5', rank: 'Zz' });
		expect(list.map((l) => l.id)).toEqual(['5', '1', '3', '2', '4']);
	});

	it('places equal ranks by id', () => {
		const list = [{ id: 'b', rank: 'a0' }];
		insertSorted(list, { id: 'a', rank: 'a0' });
		insertSorted(list, { id: 'c', rank: 'a0' });
		expect(list.map((l) => l.id)).toEqual(['a', 'b', 'c']);
	});
});
