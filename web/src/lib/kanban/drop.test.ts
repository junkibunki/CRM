// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cardDrop, columnDrop } from './drop';

const ids = (...xs: string[]) => xs.map((id) => ({ id }));
const board = { A: ids('a1', 'a2', 'a3'), B: ids('b1', 'b2'), C: [] };

describe('cardDrop', () => {
	it('dropping a card onto itself changes nothing (blocking bug from review)', () => {
		expect(cardDrop(board, 'a2', { kind: 'card', cardId: 'a2', columnId: 'A', edge: 'top' })).toBeNull();
	});

	it('dropping where it already is changes nothing', () => {
		// a2 onto the bottom edge of a1 = between a1 and a3 = its current slot
		expect(cardDrop(board, 'a2', { kind: 'card', cardId: 'a1', columnId: 'A', edge: 'bottom' })).toBeNull();
		// last card into the empty space of its own list
		expect(cardDrop(board, 'a3', { kind: 'list', columnId: 'A' })).toBeNull();
	});

	it('moves within a column, counting without the dragged card', () => {
		// a1 onto the bottom of a3 -> end of [a2, a3] = index 2
		expect(cardDrop(board, 'a1', { kind: 'card', cardId: 'a3', columnId: 'A', edge: 'bottom' })).toEqual({
			columnId: 'A',
			toIndex: 2
		});
		// a3 onto the top of a1 -> index 0
		expect(cardDrop(board, 'a3', { kind: 'card', cardId: 'a1', columnId: 'A', edge: 'top' })).toEqual({
			columnId: 'A',
			toIndex: 0
		});
	});

	it('moves to another column at the edge position', () => {
		expect(cardDrop(board, 'a1', { kind: 'card', cardId: 'b2', columnId: 'B', edge: 'top' })).toEqual({
			columnId: 'B',
			toIndex: 1
		});
		expect(cardDrop(board, 'a1', { kind: 'card', cardId: 'b2', columnId: 'B', edge: 'bottom' })).toEqual({
			columnId: 'B',
			toIndex: 2
		});
	});

	it('appends when dropped into the list area, also into an empty column', () => {
		expect(cardDrop(board, 'a1', { kind: 'list', columnId: 'B' })).toEqual({ columnId: 'B', toIndex: 2 });
		expect(cardDrop(board, 'a1', { kind: 'list', columnId: 'C' })).toEqual({ columnId: 'C', toIndex: 0 });
	});

	it('ignores a target card that is not in the column', () => {
		expect(cardDrop(board, 'a1', { kind: 'card', cardId: 'zz', columnId: 'B', edge: 'top' })).toBeNull();
	});
});

describe('columnDrop', () => {
	const cols = ids('c1', 'c2', 'c3');

	it('moves left or right of the target, counting without the dragged column', () => {
		expect(columnDrop(cols, 'c3', 'c1', 'left')).toBe(0);
		expect(columnDrop(cols, 'c1', 'c3', 'right')).toBe(2);
		expect(columnDrop(cols, 'c1', 'c3', 'left')).toBe(1);
	});

	it('changes nothing for itself or its current slot', () => {
		expect(columnDrop(cols, 'c2', 'c2', 'left')).toBeNull();
		expect(columnDrop(cols, 'c2', 'c1', 'right')).toBeNull();
		expect(columnDrop(cols, 'c2', 'c3', 'left')).toBeNull();
	});
});
