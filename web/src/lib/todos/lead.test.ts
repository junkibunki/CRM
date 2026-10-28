import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import { compareLeadTodos, LeadTodoStore, useLeadTodos } from './lead.svelte';
import type { Todo } from './types';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { filter?: string; fields?: string; expand?: string };
let listOptions: Opts[];
let subscribeOptions: Opts[];
let createOptions: (Opts | undefined)[];

/** the shared mock ignores filters and options: apply `lead = "…"`, record the options */
function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		if (name !== 'todos') return c;
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions.push(opts);
				const all = (await c.getFullList()) as Todo[];
				const m = /^lead = "(.*)"$/.exec(opts.filter ?? '');
				return m ? all.filter((t) => t.lead === m[1]) : all;
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions.push(opts ?? {});
				return c.subscribe(topic, cb);
			},
			async create(data: Record<string, unknown>, opts?: Opts) {
				createOptions.push(opts);
				return c.create(data);
			}
		};
	});
}

function todo(id: string, due: string, extra: Partial<Todo> = {}): Todo {
	const t = stamp();
	return {
		id,
		lead: 'l1',
		title: id,
		due: `${due} 00:00:00.000Z`,
		due_has_time: false,
		done: false,
		done_at: '',
		source_activity: '',
		created_by: 'u1',
		created: t,
		updated: t,
		collectionId: 'todos',
		collectionName: 'todos',
		...extra
	};
}

let store: LeadTodoStore;
let stop: () => void;
const ids = (list: Todo[]) => list.map((t) => t.id);
const updates = () => mock.calls.filter((c) => c.method === 'update' && c.collection === 'todos');

afterEach(() => {
	stop?.();
	vi.restoreAllMocks();
});

beforeEach(async () => {
	auth.logout(); // forget the last session check, then a fresh valid session
	mock.reset();
	listOptions = [];
	subscribeOptions = [];
	createOptions = [];
	wrapCollections();
	mock.set('todos', [
		todo('later', '2026-11-10'),
		todo('soon', '2026-11-01', { source_activity: 'a1' }),
		todo('old', '2026-10-01', { done: true, done_at: '2026-10-02 10:00:00.000Z' }),
		todo('older', '2026-09-01', { done: true, done_at: '2026-09-02 10:00:00.000Z', source_activity: 'a1' }),
		todo('other-lead', '2026-10-01', { lead: 'l2' })
	]);
	store = new LeadTodoStore('l1');
	stop = store.sync();
	await flush();
	mock.calls.length = 0;
});

describe('LeadTodoStore: loading', () => {
	it('loads only this lead, open ones by due date, done ones below (latest first)', () => {
		expect(listOptions[0].filter).toBe('lead = "l1"');
		expect(ids(store.list)).toEqual(['soon', 'later', 'old', 'older']);
		expect(ids(store.open)).toEqual(['soon', 'later']);
		expect(ids(store.done)).toEqual(['old', 'older']);
	});

	it('expands the source note on load and in realtime (few fields)', () => {
		expect(listOptions[0].expand).toBe('source_activity');
		expect(subscribeOptions[0].expand).toBe('source_activity');
		expect(subscribeOptions[0].fields).toContain('expand.source_activity.occurred_at');
		expect(subscribeOptions[0].fields).not.toContain('expand.source_activity.body');
	});

	it('finds the to-dos made from a note', () => {
		expect(ids(store.fromActivity('a1'))).toEqual(['soon', 'older']);
		expect(store.fromActivity('nope')).toEqual([]);
	});
});

describe('LeadTodoStore: ticking off', () => {
	it('moves it to the done ones at once and sends only done + done_at', async () => {
		const pending = store.toggle('soon');
		expect(ids(store.open)).toEqual(['later']);
		expect(ids(store.done)[0]).toBe('soon');
		await pending;
		const body = updates()[0].args[1] as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(['done', 'done_at']);
		expect(body.done).toBe(true);
		expect(body.done_at).not.toBe('');
	});

	it('taking it back clears done_at', async () => {
		await store.toggle('old');
		expect(updates()[0].args[1]).toEqual({ done: false, done_at: '' });
		expect(ids(store.open)).toEqual(['old', 'soon', 'later']);
	});

	it('rolls back on failure', async () => {
		mock.fail('update', apiError(500, 'kaputt'), 'todos');
		await store.toggle('soon');
		expect(ids(store.open)).toEqual(['soon', 'later']);
		expect(store.get('soon')?.done_at).toBe('');
		expect(store.error).toBe('kaputt');
	});

	it('keeps what someone else saved meanwhile when our save fails', async () => {
		const release = mock.hold('todos', 'update');
		mock.fail('update', apiError(500, 'kaputt'), 'todos');
		const pending = store.update('soon', { title: 'Meins' });
		await flush();
		mock.emit('todos', 'update', todo('soon', '2026-11-01', { title: 'Von B', source_activity: 'a1' }));
		release();
		await pending;
		expect(store.get('soon')?.title).toBe('Von B');
	});

	it('removes it on 404 with a valid session (deleted by someone else)', async () => {
		mock.fail('update', apiError(404), 'todos');
		await store.toggle('soon');
		expect(store.get('soon')).toBeUndefined();
		expect(store.error).toBe('');
	});
});

describe('LeadTodoStore: editing and deleting', () => {
	it('sends only the given fields and re-sorts', async () => {
		await store.update('later', { due: '2026-10-20 00:00:00.000Z' });
		expect(updates()[0].args).toEqual(['later', { due: '2026-10-20 00:00:00.000Z' }]);
		expect(ids(store.open)).toEqual(['later', 'soon']);
	});

	it('sends nothing for no changes', async () => {
		await store.update('later', {});
		expect(updates()).toHaveLength(0);
	});

	it('deletes optimistically and restores on failure', async () => {
		mock.fail('delete', apiError(500, 'nein'), 'todos');
		const pending = store.delete('soon');
		expect(store.get('soon')).toBeUndefined();
		await pending;
		expect(ids(store.open)).toEqual(['soon', 'later']);
		expect(store.error).toBe('nein');
	});

	it('does not restore a deleted to-do someone else changed meanwhile', async () => {
		const release = mock.hold('todos', 'delete');
		mock.fail('delete', apiError(500, 'nein'), 'todos');
		const pending = store.delete('soon');
		await flush();
		mock.emit('todos', 'delete', todo('soon', '2026-11-01'));
		release();
		await pending;
		expect(store.get('soon')).toBeUndefined();
	});
});

describe('LeadTodoStore: create', () => {
	it('creates as the current user, with the source note, and shows it once', async () => {
		const rec = await store.create({
			title: 'Aus Notiz',
			due: '2026-10-29 00:00:00.000Z',
			due_has_time: false,
			source_activity: 'a2'
		});
		const sent = mock.calls.find((c) => c.method === 'create')!.args[0];
		expect(sent).toMatchObject({ lead: 'l1', created_by: 'u1', done: false, source_activity: 'a2' });
		expect(createOptions[0]?.expand).toBe('source_activity');
		mock.emit('todos', 'create', JSON.parse(JSON.stringify(rec)));
		expect(store.list.filter((t) => t.id === rec.id)).toHaveLength(1);
		expect(ids(store.open)[0]).toBe(rec.id);
	});

	it('checks the session when creating fails with 403 (guest answer)', async () => {
		const refresh = vi.spyOn(auth, 'refresh');
		mock.fail('create', apiError(403), 'todos');
		await expect(store.create({ title: 'x', due: '2026-10-29 00:00:00.000Z', due_has_time: false })).rejects.toThrow();
		expect(refresh).toHaveBeenCalled();
	});
});

describe('LeadTodoStore: realtime', () => {
	it('adds, updates and removes to-dos of this lead only', () => {
		mock.emit('todos', 'create', todo('new', '2026-10-15'));
		expect(ids(store.open)).toEqual(['new', 'soon', 'later']);
		mock.emit('todos', 'update', todo('new', '2026-10-15', { done: true, done_at: '2026-10-28 08:00:00.000Z' }));
		expect(ids(store.done)[0]).toBe('new');
		mock.emit('todos', 'delete', todo('new', '2026-10-15'));
		expect(store.get('new')).toBeUndefined();
		mock.emit('todos', 'create', todo('foreign', '2026-10-15', { lead: 'l2' }));
		expect(store.get('foreign')).toBeUndefined();
	});

	it('keeps the object of an updated to-do (no re-render of the whole list)', () => {
		const before = store.get('later');
		mock.emit('todos', 'update', todo('later', '2026-11-10', { title: 'Neu' }));
		expect(store.get('later')).toBe(before);
		expect(before?.title).toBe('Neu');
	});

	it('a note deleted elsewhere clears the link (event without expand)', () => {
		mock.emit('todos', 'update', todo('soon', '2026-11-01', { source_activity: '' }));
		expect(store.fromActivity('a1').map((t) => t.id)).toEqual(['older']);
		expect(store.get('soon')?.expand).toBeUndefined();
	});

	it('reloads after a reconnect, unchanged to-dos keep their object', async () => {
		const kept = store.get('later');
		mock.db.todos = mock.db.todos.filter((t) => t.id !== 'soon');
		mock.reconnect();
		await flush();
		expect(ids(store.open)).toEqual(['later']);
		expect(store.get('later')).toBe(kept);
	});
});

describe('useLeadTodos: one shared store per lead', () => {
	it('shares one subscription and stops it when the last user releases', async () => {
		const subs = mock.subscriberCount('todos');
		const a = useLeadTodos('l7');
		const b = useLeadTodos('l7');
		await flush();
		expect(a.store).toBe(b.store);
		expect(mock.subscriberCount('todos')).toBe(subs + 1);
		a.release();
		a.release(); // twice is harmless
		await flush();
		expect(mock.subscriberCount('todos')).toBe(subs + 1);
		b.release();
		await flush();
		expect(mock.subscriberCount('todos')).toBe(subs);
		const c = useLeadTodos('l7');
		expect(c.store).not.toBe(a.store);
		c.release();
	});
});

describe('compareLeadTodos', () => {
	it('open before done, done by done_at descending', () => {
		const list = [
			todo('d1', '2026-01-01', { done: true, done_at: '2026-01-01 00:00:00.000Z' }),
			todo('o1', '2026-12-01'),
			todo('d2', '2026-01-01', { done: true, done_at: '2026-02-01 00:00:00.000Z' })
		];
		expect(ids(list.sort(compareLeadTodos))).toEqual(['o1', 'd2', 'd1']);
	});
});
