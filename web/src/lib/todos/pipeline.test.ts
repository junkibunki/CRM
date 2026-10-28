import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import { PipelineTodoStore } from './pipeline.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { filter?: string; fields?: string; sort?: string };
let listOptions: Opts[];
let subscribeOptions: Opts[];

/** the shared mock ignores filters: apply `done = false` like the server, record the options */
function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		if (name !== 'todos') return c;
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions.push(opts);
				const all = (await c.getFullList()) as { id: string; done?: boolean }[];
				return opts.filter?.includes('done = false') ? all.filter((t) => !t.done) : all;
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions.push(opts ?? {});
				return c.subscribe(topic, cb);
			}
		};
	});
}

const todo = (id: string, lead: string, due: string, extra: Record<string, unknown> = {}) => ({
	id,
	lead,
	title: `To-Do ${id}`,
	due: `${due} 00:00:00.000Z`,
	due_has_time: false,
	done: false,
	created: stamp(),
	...extra
});

let store: PipelineTodoStore;
let stop: () => void;

afterEach(() => {
	stop?.();
	vi.restoreAllMocks();
});

beforeEach(async () => {
	auth.logout(); // forget the last session check, then a fresh valid session
	mock.reset();
	listOptions = [];
	subscribeOptions = [];
	wrapCollections();
	mock.set('todos', [
		todo('t1', 'l1', '2026-11-05'),
		todo('t2', 'l1', '2026-11-01'),
		todo('t3', 'l2', '2026-11-03'),
		todo('done', 'l3', '2026-10-01', { done: true })
	]);
	store = new PipelineTodoStore('b1');
	stop = store.sync();
	await flush();
});

const nextId = (lead: string) => store.nextFor(lead)?.id;

describe('PipelineTodoStore: loading', () => {
	it('loads all open to-dos of the pipeline with ONE query and maps each lead to its next one', () => {
		expect(store.loaded).toBe(true);
		const lists = mock.calls.filter((c) => c.collection === 'todos' && c.method === 'getFullList');
		expect(lists).toHaveLength(1);
		expect(listOptions[0].filter).toBe('done = false && lead.column.board = "b1"');
		expect(listOptions[0].fields).toContain('due_has_time');
		expect(nextId('l1')).toBe('t2');
		expect(nextId('l2')).toBe('t3');
		expect(store.nextFor('l3')).toBeUndefined();
	});

	it('subscribes by board only, not by done (a ticked-off to-do must still arrive)', () => {
		expect(subscribeOptions[0].filter).toBe('lead.column.board = "b1"');
		expect(subscribeOptions[0].filter).not.toContain('done');
	});

	it('ignores done ones even if the server sent them', async () => {
		stop();
		mock.set('todos', [todo('d', 'l9', '2026-01-01', { done: true }), todo('o', 'l9', '2026-02-01')]);
		vi.restoreAllMocks(); // plain mock without the done filter
		store = new PipelineTodoStore('b1');
		stop = store.sync();
		await flush();
		expect(nextId('l9')).toBe('o');
	});
});

describe('PipelineTodoStore: realtime', () => {
	it('an earlier new to-do becomes the next one', () => {
		mock.emit('todos', 'create', todo('t4', 'l1', '2026-10-30'));
		expect(nextId('l1')).toBe('t4');
	});

	it('ticked off (done = true) by someone else: the next one moves up', () => {
		mock.emit('todos', 'update', todo('t2', 'l1', '2026-11-01', { done: true }));
		expect(nextId('l1')).toBe('t1');
	});

	it('taken back (done = false again) comes back', () => {
		mock.emit('todos', 'update', todo('t2', 'l1', '2026-11-01', { done: true }));
		mock.emit('todos', 'update', todo('t2', 'l1', '2026-11-01'));
		expect(nextId('l1')).toBe('t2');
	});

	it('deleted: the lead has no next to-do any more', () => {
		mock.emit('todos', 'delete', todo('t3', 'l2', '2026-11-03'));
		expect(store.nextFor('l2')).toBeUndefined();
	});

	it('a later due date lets another one move up; a changed title shows', () => {
		mock.emit('todos', 'update', todo('t2', 'l1', '2026-12-01'));
		expect(nextId('l1')).toBe('t1');
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-11-05', { title: 'Neu' }));
		expect(store.nextFor('l1')?.title).toBe('Neu');
	});

	it('a to-do moved to another lead leaves the old one', () => {
		mock.emit('todos', 'update', todo('t3', 'l1', '2026-10-01'));
		expect(store.nextFor('l2')).toBeUndefined();
		expect(nextId('l1')).toBe('t3');
	});

	it('changes only the entry of the affected lead (other cards keep their object)', () => {
		const other = store.nextFor('l2');
		mock.emit('todos', 'create', todo('t4', 'l1', '2026-10-30'));
		expect(store.nextFor('l2')).toBe(other);
	});

	it('does not replace the entry when the next to-do did not change', () => {
		const before = store.nextFor('l1');
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-11-05', { title: 'anders' })); // not the next one
		expect(store.nextFor('l1')).toBe(before);
	});

	it('buffers events that arrive while loading', async () => {
		stop();
		const release = mock.hold('todos', 'getFullList');
		store = new PipelineTodoStore('b1');
		stop = store.sync();
		await flush();
		mock.emit('todos', 'create', todo('t9', 'l2', '2026-10-01'));
		release();
		await flush();
		expect(nextId('l2')).toBe('t9');
	});

	it('reloads after a reconnect (a to-do deleted while offline disappears)', async () => {
		mock.set('todos', [todo('t1', 'l1', '2026-11-05')]);
		mock.reconnect();
		await flush();
		expect(nextId('l1')).toBe('t1');
		expect(store.nextFor('l2')).toBeUndefined();
	});
});

describe('PipelineTodoStore: tick off from the quick view', () => {
	it('removes it at once and saves done with done_at', async () => {
		const pending = store.complete('t2');
		expect(nextId('l1')).toBe('t1'); // optimistic
		await pending;
		const upd = mock.calls.find((c) => c.method === 'update' && c.collection === 'todos')!;
		expect(upd.args[0]).toBe('t2');
		const body = upd.args[1] as { done: boolean; done_at: string };
		expect(body.done).toBe(true);
		expect(body.done_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(nextId('l1')).toBe('t1');
	});

	it('comes back when saving fails', async () => {
		mock.fail('update', apiError(500, 'kaputt'), 'todos');
		await store.complete('t2');
		expect(nextId('l1')).toBe('t2');
		expect(store.error).toBe('kaputt');
	});

	it('does not come back over a newer realtime state (deleted by someone else meanwhile)', async () => {
		const release = mock.hold('todos', 'update');
		mock.fail('update', apiError(500, 'kaputt'), 'todos');
		const pending = store.complete('t2');
		await flush();
		mock.emit('todos', 'delete', todo('t2', 'l1', '2026-11-01'));
		release();
		await pending;
		expect(nextId('l1')).toBe('t1');
	});

	it('stays gone on 404 with a valid session (deleted by someone else)', async () => {
		mock.fail('update', apiError(404), 'todos');
		await store.complete('t2');
		expect(nextId('l1')).toBe('t1');
		expect(store.error).toBe('');
	});
});

describe('PipelineTodoStore: create from the quick view', () => {
	it('shows the new to-do at once and does not duplicate it when its event follows', async () => {
		const rec = await store.create('l2', { title: 'Anrufen', due: '2026-10-29 00:00:00.000Z', due_has_time: false });
		expect(nextId('l2')).toBe(rec.id);
		const created = mock.calls.find((c) => c.method === 'create' && c.collection === 'todos')!;
		expect(created.args[0]).toMatchObject({ lead: 'l2', title: 'Anrufen', done: false, created_by: 'u1' });
		mock.emit('todos', 'create', { ...rec, done: false });
		mock.emit('todos', 'delete', todo('t3', 'l2', '2026-11-03'));
		expect(nextId('l2')).toBe(rec.id);
	});

	it('throws on failure (the form shows the message) and changes nothing', async () => {
		mock.fail('create', apiError(400, 'Failed', { title: { code: 'x', message: 'Pflicht' } }), 'todos');
		await expect(
			store.create('l2', { title: '', due: '2026-10-29 00:00:00.000Z', due_has_time: false })
		).rejects.toThrow();
		expect(nextId('l2')).toBe('t3');
	});
});
