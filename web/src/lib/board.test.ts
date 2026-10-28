import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { BoardStore } from './board.svelte';
import { byRank } from './rank';

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

	it('reports edits to a stage deleted meanwhile (already gone locally)', async () => {
		mock.emit('board_columns', 'delete', { id: 'c2', board: 'b1', name: 'Angebot', rank: 'a1' });
		await store.updateColumn('c2', { name: 'zu spät' });
		expect(store.error).toMatch(/Phase.*gelöscht/);
		stop();
	});

	it('reports edits to a stage deleted meanwhile (404 from the server)', async () => {
		mock.fail('update', apiError(404, 'gone'), 'board_columns');
		await store.updateColumn('c2', { name: 'zu spät' });
		expect(store.columns.map((c) => c.id)).toEqual(['c1']);
		expect(store.error).toMatch(/Phase.*gelöscht/);
		stop();
	});
});

describe('BoardStore: rollback keeps newer changes of others', () => {
	it('restores the previous value of a lead field when saving fails', async () => {
		mock.fail('update', apiError(500, 'boom'), 'leads');
		await store.updateLead('l1', { title: 'Meins' });
		expect(store.leads.c1![0].title).toBe('l1');
		expect(store.error).not.toBe('');
		stop();
	});

	it('keeps a lead field someone else changed while our save was failing', async () => {
		const release = mock.hold('leads', 'update');
		mock.fail('update', apiError(500, 'boom'), 'leads');
		const pending = store.updateLead('l1', { title: 'Meins', expected_close: '2027-01-01' });
		await flush();
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { title: 'Von B' }));
		release();
		await pending;
		const l1 = store.leads.c1![0];
		expect(l1.title).toBe('Von B'); // newer value of B, not our old one
		expect(l1.expected_close).toBe(''); // the value from B's record (= the old one), not ours
		stop();
	});

	it('keeps a stage field someone else changed while our save was failing', async () => {
		const release = mock.hold('board_columns', 'update');
		mock.fail('update', apiError(500, 'boom'), 'board_columns');
		const pending = store.updateColumn('c1', { name: 'Meins', wip_limit: 3 });
		await flush();
		mock.emit('board_columns', 'update', { id: 'c1', board: 'b1', name: 'Von B', rank: 'a0', wip_limit: 0 });
		release();
		await pending;
		const c1 = store.columns.find((c) => c.id === 'c1')!;
		expect(c1.name).toBe('Von B');
		expect(c1.wip_limit).toBe(0);
		stop();
	});
});

describe('BoardStore: pipeline rollback', () => {
	it('keeps a pipeline name someone else saved while our save was failing', async () => {
		const release = mock.hold('boards', 'update');
		mock.fail('update', apiError(500, 'boom'), 'boards');
		const pending = store.updateBoard({ name: 'Meins', card_fields: ['owner'] });
		await flush();
		mock.emit('boards', 'update', { id: 'b1', name: 'Von B', card_fields: ['company'] });
		release();
		await pending;
		expect(store.board!.name).toBe('Von B');
		expect(store.board!.card_fields).toEqual(['company']);
		stop();
	});
});

describe('BoardStore: contacts are saved as a difference', () => {
	const body = () => updates().at(-1)!.args[1] as Record<string, unknown>;

	it('sends added contacts as contacts+ and keeps one someone else added meanwhile', async () => {
		// B added "b" while our dialog (opened with ['ct']) was open
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['ct', 'b'] }));
		await store.updateLead('l1', { contacts: ['ct', 'mine'] }, { contacts: ['ct'] });
		expect(body()).toEqual({ 'contacts+': ['mine'] });
		expect(store.leads.c1![0].contacts).toEqual(['ct', 'b', 'mine']);
		stop();
	});

	it('sends removed contacts as contacts- together with other fields', async () => {
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['ct', 'x', 'b'] }));
		await store.updateLead('l1', { title: 'T', contacts: ['ct'] }, { title: 'l1', contacts: ['ct', 'x'] });
		expect(body()).toEqual({ title: 'T', 'contacts-': ['x'] });
		expect(store.leads.c1![0].contacts).toEqual(['ct', 'b']);
		stop();
	});

	it('saves nothing when only the order of the contacts differs', async () => {
		await store.updateLead('l1', { contacts: ['b', 'ct'] }, { contacts: ['ct', 'b'] });
		expect(updates()).toHaveLength(0);
		stop();
	});

	it('still sends the whole list without a starting state', async () => {
		await store.updateLead('l1', { contacts: ['ct', 'mine'] });
		expect(body()).toEqual({ contacts: ['ct', 'mine'] });
		stop();
	});

	it('rolls the contacts back when saving fails', async () => {
		mock.fail('update', apiError(500, 'boom'), 'leads');
		await store.updateLead('l1', { contacts: ['ct', 'mine'] }, { contacts: ['ct'] });
		expect(store.leads.c1![0].contacts).toEqual(['ct']);
		stop();
	});
});

describe('BoardStore: invalid session on create', () => {
	const data = { title: 'x', company: 'co', contacts: ['ct'], expected_close: '', owner: 'u1' };

	it('checks the session when creating a lead fails with 400 (guest answer)', async () => {
		mock.fail('create', apiError(400, 'Failed to create record.'), 'leads');
		mock.invalidateSession();
		expect(await store.addLead('c1', data)).toBe(false);
		expect(mock.pb.authStore.token).toBe(''); // logged out right away
		stop();
	});

	it('checks the session when creating a stage fails with 400 (guest answer)', async () => {
		mock.fail('create', apiError(400, 'Failed to create record.'), 'board_columns');
		mock.invalidateSession();
		await store.addColumn({ name: 'x', color: '', wip_limit: 0 });
		expect(mock.pb.authStore.token).toBe('');
		stop();
	});

	it('keeps a valid session on a plain validation error', async () => {
		mock.fail('create', apiError(400, 'Failed to create record.'), 'leads');
		expect(await store.addLead('c1', data)).toBe(false);
		expect(mock.pb.authStore.token).toBe('test-token');
		expect(store.error).not.toBe('');
		stop();
	});
});

describe('BoardStore: re-ranking with a failed update', () => {
	it('keeps local ranks equal to the server when one of the re-rank updates fails', async () => {
		mock.set('leads', [lead('x1', 'c2', 'b0'), lead('x2', 'c2', 'b0'), lead('x3', 'c2', 'b0'), lead('m', 'c1', 'a5')]);
		mock.reconnect();
		await flush();
		mock.fail('update', apiError(500, 'boom'), 'leads'); // the first re-rank update (x1)
		await store.moveLead('m', 'c2', 1);
		expect(store.error).not.toBe('');
		expect(titles('c1')).toEqual(['m']); // the move itself did not happen
		const server = new Map(mock.db.leads!.map((l) => [l.id, l.rank]));
		for (const l of store.leads.c2!) expect(l.rank).toBe(server.get(l.id));
		const ranks = store.leads.c2!.map((l) => l.rank);
		expect([...ranks].sort()).toEqual(ranks); // still in rank order
		stop();
	});

	// order the server returns for `sort=rank,id`
	const serverOrder = (collection: string, keep: (r: { [k: string]: unknown }) => boolean) =>
		(mock.db[collection] ?? [])
			.filter(keep)
			.map((r) => r as unknown as { id: string; rank: string })
			.sort(byRank)
			.map((r) => r.id);

	async function restart(columns: object[], leads: object[]) {
		stop();
		mock.set('board_columns', columns as { id: string }[]);
		mock.set('leads', leads as { id: string }[]);
		store = new BoardStore('b1');
		stop = store.sync();
		await flush();
		mock.calls.length = 0;
	}

	it('stages: local order equals the server order after a partly failed re-rank', async () => {
		const col = (id: string, rank: string) => ({ id, board: 'b1', name: id, rank, updated: stamp() });
		await restart([col('cA', 'a0'), col('cB', 'a0'), col('cC', 'a0'), col('cD', 'a1')], []);
		mock.fail('update', apiError(500, 'boom'), 'board_columns'); // re-rank of A fails
		await store.moveColumn('cD', 1); // between A and B (equal ranks)
		expect(store.error).not.toBe('');
		const server = new Map(mock.db.board_columns!.map((c) => [c.id, c.rank]));
		for (const c of store.columns) expect(c.rank).toBe(server.get(c.id));
		expect(store.columns.map((c) => c.id)).toEqual(serverOrder('board_columns', () => true));
		expect(store.columns.map((c) => c.id)).toEqual(['cA', 'cB', 'cD', 'cC']);
		stop();
	});

	it('lead moved within its stage: local order equals the server order after a partly failed re-rank', async () => {
		await restart(
			[{ id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', updated: stamp() }],
			[lead('x1', 'c1', 'a0'), lead('x2', 'c1', 'a0'), lead('x3', 'c1', 'a0'), lead('xm', 'c1', 'a1')]
		);
		mock.fail('update', apiError(500, 'boom'), 'leads'); // re-rank of x1 fails
		await store.moveLead('xm', 'c1', 1);
		expect(store.error).not.toBe('');
		const server = new Map(mock.db.leads!.map((l) => [l.id, l.rank]));
		for (const l of store.leads.c1!) expect(l.rank).toBe(server.get(l.id));
		expect(titles('c1')).toEqual(serverOrder('leads', (l) => l.column === 'c1'));
		expect(titles('c1')).toEqual(['x1', 'x2', 'xm', 'x3']);
		stop();
	});

	it('matches re-rank results to the right items when realtime inserts into the live list meanwhile', async () => {
		await restart(
			[{ id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', updated: stamp() }],
			[lead('x1', 'c1', 'b0'), lead('x2', 'c1', 'b0')]
		);
		const release = mock.hold('leads', 'update'); // x1's re-rank update waits
		mock.fail('update', apiError(500, 'boom'), 'leads'); // x2's fails
		// called with the live list, as addLead/addColumn do; position 1 collides
		const rankAt = (store as unknown as { rankAt: (l: unknown[], i: number, c: string) => Promise<string> })
			.rankAt.bind(store);
		const pending = rankAt(store.leads.c1!, 1, 'leads').catch(() => 'failed');
		await flush();
		const n0 = lead('n0', 'c1', 'a0');
		mock.db.leads!.push(n0);
		mock.emit('leads', 'create', n0); // lands at index 0 of the live list
		release();
		expect(await pending).toBe('failed');
		const server = new Map(mock.db.leads!.map((l) => [l.id, l.rank]));
		for (const l of store.leads.c1!) expect(l.rank).toBe(server.get(l.id));
		expect(titles('c1')).toEqual(serverOrder('leads', (l) => l.column === 'c1'));
		stop();
	});

	it('checks the session when a re-rank update fails with a guest answer', async () => {
		mock.set('leads', [lead('x1', 'c2', 'b0'), lead('x2', 'c2', 'b0'), lead('m', 'c1', 'a5')]);
		mock.reconnect();
		await flush();
		mock.fail('update', apiError(404, 'guest'), 'leads');
		mock.invalidateSession();
		await store.moveLead('m', 'c2', 1);
		expect(mock.pb.authStore.token).toBe(''); // logged out
		stop();
	});
});

describe('BoardStore: stage gates (F12)', () => {
	const data = { title: 'Gate', company: 'co', contacts: ['ct'], expected_close: '', owner: 'u1' };
	type Send = (path: string, opts: { method: string; body: Record<string, unknown> }) => Promise<unknown>;
	const pbSend = mock.pb as unknown as { send?: Send };
	const msg = 'Bevor der Lead nach „Angebot“ kann, muss diese Bedingung erfüllt sein: „X“.';

	afterEach(() => delete pbSend.send);

	it('creates a lead with confirmations through POST /api/crm/leads (one transaction)', async () => {
		const sent: { path: string; method: string; body: Record<string, unknown> }[] = [];
		pbSend.send = async (path, opts) => {
			sent.push({ path, ...opts });
			return { lead: lead('new', 'c2', String(opts.body.rank)), checks: [] };
		};
		const checks = [{ requirement: 'r1', value: 'true' }];
		expect(await store.addLead('c2', data, checks)).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0].path).toBe('/api/crm/leads');
		expect(sent[0].method).toBe('POST');
		expect(sent[0].body).toMatchObject({ ...data, column: 'c2', checks });
		expect(typeof sent[0].body.rank).toBe('string');
		expect(mock.calls.some((c) => c.collection === 'leads' && c.method === 'create')).toBe(false);
		expect(titles('c2')).toEqual(['l4', 'new']);
		// the realtime create of the same lead is deduped
		mock.emit('leads', 'create', lead('new', 'c2', String(sent[0].body.rank)));
		expect(titles('c2')).toEqual(['l4', 'new']);
		stop();
	});

	it('without confirmations it uses the normal create', async () => {
		pbSend.send = async () => {
			throw new Error('route must not be used');
		};
		expect(await store.addLead('c1', data)).toBe(true);
		expect(mock.calls.some((c) => c.collection === 'leads' && c.method === 'create')).toBe(true);
		stop();
	});

	it('a refused create shows the server sentence and resolves false (dialog stays open)', async () => {
		pbSend.send = async () => {
			throw apiError(400, msg, { column: { code: 'gate_open', message: msg } });
		};
		expect(await store.addLead('c2', data, [])).toBe(false);
		expect(store.error).toBe(msg);
		expect(titles('c2')).toEqual(['l4']);
		stop();
	});

	it('a move refused by the gate rolls back and shows the sentence without the field name', async () => {
		mock.fail('update', apiError(400, 'x', { column: { code: 'gate_open', message: msg } }), 'leads');
		await store.moveLead('l1', 'c2', 0);
		expect(titles('c1')).toEqual(['l1', 'l2', 'l3']);
		expect(store.error).toBe(msg);
		stop();
	});

	it('addColumn resolves the new stage (its requirements are created next), null on failure', async () => {
		const rec = await store.addColumn({ name: 'Neu2', color: 'gray', wip_limit: 0, closed: false });
		expect(rec?.name).toBe('Neu2');
		expect(store.columns.map((c) => c.id)).toContain(rec!.id);
		mock.fail('create', apiError(500, 'x'), 'board_columns');
		expect(await store.addColumn({ name: 'y', color: 'gray', wip_limit: 0, closed: false })).toBeNull();
		stop();
	});
});
