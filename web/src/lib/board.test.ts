import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { BoardStore } from './board.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const lead = (id: string, column: string, rank: string, extra = {}) => ({
	id,
	column,
	rank,
	title: id,
	company: 'co',
	contacts: ['ct'],
	expected_close: '',
	owner: 'u1',
	created: stamp(),
	updated: stamp(),
	...extra
});

let store: BoardStore;
let stop: () => void;

const titles = (col: string) => (store.leads[col] ?? []).map((l) => l.id);
const updates = () => mock.calls.filter((c) => c.method === 'update' && c.collection === 'leads');

afterEach(() => stop?.());

beforeEach(async () => {
	mock.reset();
	mock.set('boards', [{ id: 'b1', name: 'Leads', card_fields: ['company'] }]);
	mock.set('board_columns', [
		{ id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', updated: stamp() },
		{ id: 'c2', board: 'b1', name: 'Angebot', rank: 'a1', updated: stamp() }
	]);
	mock.set('leads', [lead('l1', 'c1', 'a0'), lead('l2', 'c1', 'a1'), lead('l3', 'c1', 'a2'), lead('l4', 'c2', 'a0')]);
	store = new BoardStore('b1');
	stop = store.sync();
	await flush();
	mock.calls.length = 0;
});

describe('BoardStore: loading', () => {
	it('groups leads per stage in rank order', () => {
		expect(store.loading).toBe(false);
		expect(store.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
		expect(titles('c1')).toEqual(['l1', 'l2', 'l3']);
		expect(titles('c2')).toEqual(['l4']);
		stop();
	});
});

describe('BoardStore: moving', () => {
	it('moves within a stage with exactly one update and a rank between the neighbours', async () => {
		await store.moveLead('l3', 'c1', 0);
		expect(titles('c1')).toEqual(['l3', 'l1', 'l2']);
		expect(updates()).toHaveLength(1);
		const [, data] = updates()[0].args as [string, { column: string; rank: string }];
		expect(data.column).toBe('c1');
		expect(data.rank < 'a0').toBe(true);
		stop();
	});

	it('moves to another stage without touching the other leads', async () => {
		await store.moveLead('l1', 'c2', 1);
		expect(titles('c1')).toEqual(['l2', 'l3']);
		expect(titles('c2')).toEqual(['l4', 'l1']);
		expect(updates().map((u) => u.args[0])).toEqual(['l1']);
		stop();
	});

	it('rolls back when saving fails', async () => {
		mock.fail('update', apiError(500, 'boom'), 'leads');
		await store.moveLead('l1', 'c2', 0);
		expect(titles('c1')).toEqual(['l1', 'l2', 'l3']);
		expect(titles('c2')).toEqual(['l4']);
		expect(store.error).not.toBe('');
		stop();
	});

	it('removes the card when the lead was deleted by someone else (404, session valid)', async () => {
		mock.fail('update', apiError(404, 'gone'), 'leads');
		await store.moveLead('l1', 'c2', 0);
		expect(store.findLead('l1')).toBeNull();
		stop();
	});

	it('does not drop the card on a 404 caused by an invalid session, but logs out', async () => {
		mock.fail('update', apiError(404, 'guest'), 'leads');
		mock.invalidateSession();
		await store.moveLead('l1', 'c2', 0);
		expect(titles('c1')).toEqual(['l1', 'l2', 'l3']); // rolled back, not removed
		expect(mock.pb.authStore.token).toBe('');
		stop();
	});

	it('gives the whole stage fresh ranks when the neighbours collide', async () => {
		mock.set('leads', [lead('x1', 'c2', 'a0'), lead('x2', 'c2', 'a0'), lead('m', 'c1', 'a5')]);
		mock.reconnect();
		await flush();
		mock.calls.length = 0;
		await store.moveLead('m', 'c2', 1); // between the two equal ranks
		expect(titles('c2')).toEqual(['x1', 'm', 'x2']);
		const ranks = (store.leads.c2 ?? []).map((l) => l.rank);
		expect(new Set(ranks).size).toBe(3);
		expect([...ranks].sort()).toEqual(ranks);
		stop();
	});
});

describe('BoardStore: realtime', () => {
	it('moves a card between stages when another user moves it', () => {
		mock.emit('leads', 'update', lead('l2', 'c2', 'Zz'));
		expect(titles('c1')).toEqual(['l1', 'l3']);
		expect(titles('c2')).toEqual(['l2', 'l4']);
		stop();
	});

	it('does not duplicate a lead created here when its realtime event follows', async () => {
		await store.addLead('c2', { title: 'Neu', company: 'co', contacts: ['ct'], expected_close: '', owner: 'u1' });
		const created = store.leads.c2!.find((l) => l.title === 'Neu')!;
		// plain copy: $state proxies can't go through structuredClone
		mock.emit('leads', 'create', JSON.parse(JSON.stringify(created)));
		expect(store.leads.c2!.filter((l) => l.title === 'Neu')).toHaveLength(1);
		stop();
	});

	it('does not apply the update response over a newer edit from someone else', async () => {
		const release = mock.hold('leads', 'update');
		const pending = store.updateLead('l1', { title: 'Meins' });
		await flush();
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { title: 'Von B', updated: '2999-01-01 00:00:00.000000Z' }));
		release();
		await pending;
		expect(store.leads.c1![0].title).toBe('Von B');
		stop();
	});

	it('reconciles after a reconnect: unchanged cards keep their object', async () => {
		const before = store.leads.c1![1]; // l2, unchanged
		mock.db.leads!.find((l) => l.id === 'l1')!.title = 'geändert';
		mock.db.leads!.find((l) => l.id === 'l1')!.updated = stamp();
		mock.db.leads = mock.db.leads!.filter((l) => l.id !== 'l3'); // deleted while offline
		mock.reconnect();
		await flush();
		expect(store.leads.c1![1]).toBe(before);
		expect(store.leads.c1![0].title).toBe('geändert');
		expect(titles('c1')).toEqual(['l1', 'l2']);
		stop();
	});
});

describe('BoardStore: messages instead of silent failures', () => {
	it('reports a stage that no longer exists when adding a lead', async () => {
		const ok = await store.addLead('gone', { title: 'x', company: 'co', contacts: ['ct'], expected_close: '', owner: 'u1' });
		expect(ok).toBe(false);
		expect(store.error).toMatch(/Phase/);
		stop();
	});

	it('reports edits to a lead deleted meanwhile', async () => {
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		await store.updateLead('l1', { title: 'zu spät' });
		expect(store.error).toMatch(/gelöscht/);
		stop();
	});
});
