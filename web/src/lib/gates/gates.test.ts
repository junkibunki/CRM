import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { auth } from '../auth.svelte';
import { GateStore } from './gates.svelte';
import type { RequirementDraft } from './types';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const columns = [
	{ id: 'c1', board: 'b1', rank: 'a0' },
	{ id: 'c2', board: 'b1', rank: 'a1' },
	{ id: 'c3', board: 'b1', rank: 'a2' }
];
const req = (id: string, column: string, type = 'flag', rank = 'a0') => ({
	id,
	column,
	type,
	rank,
	label: `L-${id}`,
	hint: '',
	updated: stamp()
});
const check = (id: string, lead: string, requirement: string, value = 'true') => ({
	id,
	lead,
	requirement,
	value,
	by: 'u1',
	created: stamp(),
	updated: stamp()
});

let store: GateStore;
let stop: () => void;
const writes = () => mock.calls.filter((c) => ['create', 'update', 'delete'].includes(c.method));

afterEach(() => stop?.());

beforeEach(async () => {
	mock.reset();
	auth.logout();
	mock.reset(); // logout cleared the mock's auth store
	mock.set('stage_requirements', [req('flag', 'c2'), req('nr', 'c3', 'text')]);
	mock.set('lead_checks', [check('k1', 'l1', 'flag')]);
	mock.set('lead_check_events', []);
	store = GateStore.forBoard('b1');
	stop = store.sync();
	await flush();
	mock.calls.length = 0;
});

describe('GateStore: loading and evaluation', () => {
	it('loads requirements and checks with ONE query each, filtered by pipeline', async () => {
		stop();
		const s = GateStore.forBoard('b1');
		const st = s.sync();
		await flush();
		const lists = mock.calls.filter((c) => c.method === 'getFullList').map((c) => c.collection);
		expect(lists.sort()).toEqual(['lead_checks', 'stage_requirements']);
		st();
		expect(s.loaded).toBe(true);
		expect(s.events).toEqual([]);
	});

	it('uses the board filter for list and subscription', async () => {
		stop();
		const calls: { name: string; opts: unknown }[] = [];
		const real = mock.pb.collection;
		vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
			const c = real(name);
			return {
				...c,
				getFullList: (opts?: unknown) => {
					calls.push({ name, opts });
					return c.getFullList();
				},
				subscribe: (topic: string, cb: never, opts?: unknown) => {
					calls.push({ name: `${name}:sub`, opts });
					return c.subscribe(topic, cb);
				}
			} as never;
		});
		const st = GateStore.forBoard('b1').sync();
		await flush();
		st();
		const of = (n: string) => calls.find((c) => c.name === n)?.opts as { filter?: string };
		expect(of('stage_requirements').filter).toBe('column.board = "b1"');
		expect(of('stage_requirements:sub').filter).toBe('column.board = "b1"');
		expect(of('lead_checks').filter).toBe('lead.column.board = "b1"');
		expect(of('lead_checks:sub').filter).toBe('lead.column.board = "b1"');
		expect(calls.some((c) => c.name.startsWith('lead_check_events'))).toBe(false);
	});

	it('requirements apply cumulatively; open ones per lead', () => {
		expect(store.applicableFor('c1', columns)).toEqual([]);
		expect(store.applicableFor('c3', columns).map((r) => r.id)).toEqual(['flag', 'nr']);
		expect(store.openFor('l1', 'c3', columns).map((r) => r.id)).toEqual(['nr']);
		expect(store.openFor('l2', 'c3', columns).map((r) => r.id)).toEqual(['flag', 'nr']);
		expect(store.openFor('l1', 'c2', columns)).toEqual([]);
	});

	it('groups requirements by stage (lock icon)', () => {
		expect(store.byColumn.get('c2')?.map((r) => r.id)).toEqual(['flag']);
		expect(store.byColumn.get('c1')).toBeUndefined();
	});
});

describe('GateStore: realtime', () => {
	it('a check of someone else arrives; the entry object of other leads stays', () => {
		const before = store.checks.get('l1');
		mock.emit('lead_checks', 'create', check('k2', 'l2', 'flag'));
		expect(store.openFor('l2', 'c2', columns)).toEqual([]);
		expect(store.checks.get('l1')).toBe(before);
	});

	it('a revoke (delete) opens the requirement again', () => {
		mock.emit('lead_checks', 'delete', check('k1', 'l1', 'flag'));
		expect(store.openFor('l1', 'c2', columns).map((r) => r.id)).toEqual(['flag']);
		expect(store.checks.has('l1')).toBe(false);
	});

	it('a new requirement shows up for every lead already in the stage', () => {
		mock.emit('stage_requirements', 'create', req('nda', 'c1'));
		expect(store.openFor('l1', 'c1', columns).map((r) => r.id)).toEqual(['nda']);
		mock.emit('stage_requirements', 'delete', req('nda', 'c1'));
		expect(store.openFor('l1', 'c1', columns)).toEqual([]);
	});

	it('an older answer does not overwrite a newer realtime state', () => {
		const newer = { ...check('k1', 'l1', 'flag'), updated: '2099-01-01 00:00:00.000Z' };
		mock.emit('lead_checks', 'update', newer);
		mock.emit('lead_checks', 'update', { ...check('k1', 'l1', 'flag', 'false') });
		expect(store.checkOf('l1', 'flag')?.value).toBe('true');
	});

	it('reloads after a reconnect without replacing unchanged entries', async () => {
		const before = store.checks.get('l1');
		mock.reconnect();
		await flush();
		expect(store.checks.get('l1')).toBe(before);
	});
});

describe('GateStore: confirm', () => {
	it('creates missing checks as the current user and skips fulfilled ones', async () => {
		await store.confirm('l1', [
			{ requirement: 'flag', value: 'true' },
			{ requirement: 'nr', value: '  S-1 ' }
		]);
		const w = writes();
		expect(w).toHaveLength(1);
		expect(w[0].method).toBe('create');
		expect(w[0].args[0]).toMatchObject({ lead: 'l1', requirement: 'nr', value: 'S-1', by: 'u1' });
		expect(store.openFor('l1', 'c3', columns)).toEqual([]);
	});

	it('updates an existing check with a new value', async () => {
		mock.set('lead_checks', [check('k1', 'l1', 'flag'), check('k9', 'l1', 'nr', 'alt')]);
		mock.emit('lead_checks', 'create', check('k9', 'l1', 'nr', 'alt'));
		await store.confirm('l1', [{ requirement: 'nr', value: 'neu' }]);
		expect(writes().map((c) => [c.method, c.args[0]])).toEqual([['update', 'k9']]);
		expect(store.checkOf('l1', 'nr')?.value).toBe('neu');
	});

	it('refuses an invalid value before sending', async () => {
		await expect(store.confirm('l2', [{ requirement: 'nr', value: '  ' }])).rejects.toThrow(/L-nr/);
		expect(writes()).toEqual([]);
	});

	it('someone else confirmed at the same moment (unique): uses that check', async () => {
		mock.fail('create', apiError(400, 'unique'), 'lead_checks');
		mock.set('lead_checks', [check('kX', 'l2', 'flag')]); // what getFirstListItem finds
		await store.confirm('l2', [{ requirement: 'flag', value: 'true' }]);
		expect(store.checkOf('l2', 'flag')?.id).toBe('kX');
	});

	it('throws the server error (and checks the session)', async () => {
		mock.fail('create', apiError(500, 'kaputt'), 'lead_checks');
		mock.set('lead_checks', []);
		await expect(store.confirm('l2', [{ requirement: 'flag', value: 'true' }])).rejects.toBeTruthy();
		expect(store.openFor('l2', 'c2', columns).map((r) => r.id)).toEqual(['flag']);
	});
});

describe('GateStore: revoke', () => {
	it('deletes the check; the lead stays (nothing else is written)', async () => {
		await store.revoke(store.checkOf('l1', 'flag')!);
		expect(writes().map((c) => [c.method, c.collection, c.args[0]])).toEqual([['delete', 'lead_checks', 'k1']]);
		expect(store.checkOf('l1', 'flag')).toBeUndefined();
	});

	it('already revoked by someone else (404): fine', async () => {
		mock.fail('delete', apiError(404, 'gone'), 'lead_checks');
		await store.revoke(store.checkOf('l1', 'flag')!);
		expect(store.checkOf('l1', 'flag')).toBeUndefined();
	});

	it('other errors are thrown and the check stays', async () => {
		mock.fail('delete', apiError(500, 'kaputt'), 'lead_checks');
		await expect(store.revoke(store.checkOf('l1', 'flag')!)).rejects.toBeTruthy();
		expect(store.checkOf('l1', 'flag')).toBeTruthy();
	});
});

describe('GateStore: saveRequirements (stage dialog)', () => {
	const draft = (d: Partial<RequirementDraft>): RequirementDraft => ({
		key: Math.random().toString(),
		label: 'x',
		type: 'flag',
		hint: '',
		...d
	});

	it('creates, updates and deletes per the draft', async () => {
		const initial = [...store.byColumn.get('c2')!];
		await store.saveRequirements(
			'c2',
			[draft({ id: 'flag', label: 'Umbenannt' }), draft({ label: 'Neu', type: 'text' })],
			initial
		);
		const w = writes();
		expect(w.find((c) => c.method === 'update')?.args).toEqual(['flag', { label: 'Umbenannt' }]);
		expect(w.find((c) => c.method === 'create')?.args[0]).toMatchObject({ column: 'c2', label: 'Neu', type: 'text' });
		expect(store.byColumn.get('c2')?.map((r) => r.label)).toEqual(['Umbenannt', 'Neu']);

		mock.calls.length = 0;
		await store.saveRequirements('c2', [], [...store.byColumn.get('c2')!]);
		expect(writes().filter((c) => c.method === 'delete')).toHaveLength(2);
		expect(store.byColumn.get('c2')).toBeUndefined();
	});

	it('keeps a requirement someone else added while the dialog was open', async () => {
		const initial = [...store.byColumn.get('c2')!];
		mock.emit('stage_requirements', 'create', req('theirs', 'c2', 'flag', 'a5'));
		await store.saveRequirements('c2', [draft({ id: 'flag', label: 'L-flag' })], initial);
		expect(writes().filter((c) => c.method === 'delete')).toEqual([]);
		expect(store.byColumn.get('c2')?.map((r) => r.id)).toContain('theirs');
	});

	it('reports a failure in `error`', async () => {
		mock.fail('create', apiError(500, 'kaputt'), 'stage_requirements');
		await store.saveRequirements('c2', [draft({ label: 'Neu' })], []);
		expect(store.error).toMatch(/^Bedingungen:/);
	});
});

describe('GateStore.forLead', () => {
	it('loads the log of the lead, newest first, and adds new entries live', async () => {
		stop();
		mock.set('lead_check_events', [
			{ id: 'e1', lead: 'l1', action: 'confirmed', requirement_label: 'x', value: 'true', by: 'u1', created: '2026-01-01 10:00:00.000Z' }
		]);
		const s = GateStore.forLead('l1');
		stop = s.sync();
		await flush();
		expect(s.events.map((e) => e.id)).toEqual(['e1']);
		const ev = { id: 'e2', lead: 'l1', action: 'revoked', requirement_label: 'x', value: 'true', by: 'u1', created: '2026-01-01 11:00:00.000Z' };
		mock.emit('lead_check_events', 'create', ev);
		mock.emit('lead_check_events', 'create', ev); // dedupe
		expect(s.events.map((e) => e.id)).toEqual(['e2', 'e1']);
	});
});
