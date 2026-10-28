// Closed stages (F7): `board_columns.closed` goes through the board store like the other
// stage fields (create, edit, rollback). Kept here, next to the feature that needs it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import { BoardStore } from '../board.svelte';
import * as pbModule from '../pb';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

let store: BoardStore;
let stop: () => void;
const columnUpdates = () => mock.calls.filter((c) => c.method === 'update' && c.collection === 'board_columns');

afterEach(() => stop?.());

beforeEach(async () => {
	auth.logout();
	mock.reset();
	mock.set('boards', [{ id: 'b1', name: 'Leads', card_fields: ['next_todo'] }]);
	mock.set('board_columns', [
		{ id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', closed: false, updated: stamp() },
		{ id: 'c2', board: 'b1', name: 'Gewonnen', rank: 'a1', closed: true, updated: stamp() }
	]);
	mock.set('leads', []);
	store = new BoardStore('b1');
	stop = store.sync();
	await flush();
	mock.calls.length = 0;
});

describe('BoardStore: closed stages', () => {
	it('loads the flag', () => {
		expect(store.columns.map((c) => c.closed)).toEqual([false, true]);
	});

	it('saves only the changed flag', async () => {
		await store.updateColumn('c1', { closed: true });
		expect(columnUpdates()[0].args).toEqual(['c1', { closed: true }]);
		expect(store.columns[0].closed).toBe(true);
	});

	it('rolls the flag back when saving fails', async () => {
		mock.fail('update', apiError(500, 'kaputt'), 'board_columns');
		await store.updateColumn('c2', { closed: false });
		expect(store.columns[1].closed).toBe(true);
	});

	it('creates a stage with the flag', async () => {
		await store.addColumn({ name: 'Verloren', color: 'red', wip_limit: 0, closed: true });
		const sent = mock.calls.find((c) => c.method === 'create' && c.collection === 'board_columns')!;
		expect(sent.args[0]).toMatchObject({ name: 'Verloren', closed: true, board: 'b1' });
		expect(store.columns.at(-1)?.closed).toBe(true);
	});

	it('follows a flag changed by someone else', () => {
		mock.emit('board_columns', 'update', { id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', closed: true });
		expect(store.columns[0].closed).toBe(true);
	});
});
