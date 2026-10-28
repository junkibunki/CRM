import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.TZ = 'Europe/Berlin';
});

import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import { countDue } from './groups';
import { MyTodosStore, type LeadInfo } from './mine.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { filter?: string; fields?: string; sort?: string; expand?: string };
let listOptions: Opts[];
let subscribeOptions: Record<string, Opts>;

/** the shared mock ignores filters: apply `done = false` like the server, record the options */
function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions.push(opts);
				const all = (await c.getFullList()) as { id: string; done?: boolean }[];
				return opts.filter?.includes('done = false') ? all.filter((t) => !t.done) : all;
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions[name] = opts ?? {};
				return c.subscribe(topic, cb);
			}
		};
	});
}

const leads: Record<string, LeadInfo> = {
	l1: { id: 'l1', title: 'Lead Eins', owner: 'u1', company: 'c1' },
	l2: { id: 'l2', title: 'Lead Zwei', owner: 'u2', company: 'c2' },
	l3: { id: 'l3', title: 'Lead Drei', owner: 'u1', company: 'c1' }
};

/** a to-do as the server sends it: with the expanded lead */
const todo = (id: string, lead: string, due: string, extra: Record<string, unknown> = {}) => ({
	id,
	lead,
	title: `To-Do ${id}`,
	due: `${due} 00:00:00.000Z`,
	due_has_time: false,
	done: false,
	created: stamp(),
	expand: { lead: leads[lead] },
	...extra
});

let store: MyTodosStore;
let stop: () => void;

afterEach(() => {
	stop?.();
	vi.restoreAllMocks();
});

beforeEach(async () => {
	auth.logout(); // forget the last session check, then a fresh valid session
	mock.reset();
	listOptions = [];
	subscribeOptions = {};
	wrapCollections();
	mock.set('todos', [
		todo('t1', 'l1', '2026-10-20'), // mine, overdue
		todo('t2', 'l2', '2026-10-28'), // someone else's, today
		todo('t3', 'l3', '2026-11-20'), // mine, later
		todo('done', 'l1', '2026-10-01', { done: true })
	]);
	store = new MyTodosStore();
	stop = store.use();
	await flush();
});

const ids = (owner: string | null) => store.list(owner).map((t) => t.id).sort();
const lists = () => mock.calls.filter((c) => c.collection === 'todos' && c.method === 'getFullList');
const updates = () => mock.calls.filter((c) => c.collection === 'todos' && c.method === 'update');

describe('MyTodosStore: loading', () => {
	it('loads all open to-dos with ONE query, with the lead (title, owner) expanded', () => {
		expect(store.loaded).toBe(true);
		expect(lists()).toHaveLength(1);
		expect(listOptions[0].filter).toBe('done = false');
		expect(listOptions[0].expand).toBe('lead');
		expect(listOptions[0].fields).toContain('due_has_time');
		expect(listOptions[0].fields).toContain('expand.lead.owner');
		expect(listOptions[0].fields).toContain('expand.lead.title');
		expect(ids(null)).toEqual(['t1', 't2', 't3']);
		expect(store.lead('l2')).toEqual(leads.l2);
	});

	it('subscribes to all to-dos without a done filter (ticking off must arrive), and to leads', () => {
		expect(subscribeOptions.todos.filter).toBeUndefined();
		expect(subscribeOptions.todos.expand).toBe('lead');
		expect(subscribeOptions.todos.fields).toContain('expand.lead.owner');
		expect(subscribeOptions.leads.fields).toBe('id,title,owner,company');
	});

	it('"mine" = to-dos of leads I own; "all users" = everything, from the same data', () => {
		expect(ids('u1')).toEqual(['t1', 't3']);
		expect(ids('u2')).toEqual(['t2']);
		expect(ids(null)).toEqual(['t1', 't2', 't3']);
		expect(lists()).toHaveLength(1); // switching asks the server nothing
	});

	it('ignores done ones even if the server sent them', async () => {
		stop();
		vi.restoreAllMocks(); // plain mock without the done filter
		store = new MyTodosStore();
		stop = store.use();
		await flush();
		expect(ids(null)).toEqual(['t1', 't2', 't3']);
	});
});

describe('MyTodosStore: realtime to-dos', () => {
	it('a new to-do on my lead appears in "mine", on someone else\'s only in "all"', () => {
		mock.emit('todos', 'create', todo('t4', 'l1', '2026-10-30'));
		mock.emit('todos', 'create', todo('t5', 'l2', '2026-10-30'));
		expect(ids('u1')).toEqual(['t1', 't3', 't4']);
		expect(ids(null)).toEqual(['t1', 't2', 't3', 't4', 't5']);
	});

	it('the create event of an already known to-do is not added twice', () => {
		mock.emit('todos', 'create', todo('t4', 'l1', '2026-10-30'));
		mock.emit('todos', 'create', todo('t4', 'l1', '2026-10-30'));
		expect(store.list(null).filter((t) => t.id === 't4')).toHaveLength(1);
	});

	it('ticked off by someone else (done = true) disappears; taken back it returns', () => {
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-10-20', { done: true }));
		expect(ids('u1')).toEqual(['t3']);
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-10-20'));
		expect(ids('u1')).toEqual(['t1', 't3']);
	});

	it('a changed due date or title is taken over', () => {
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-12-24', { title: 'Neu' }));
		const t = store.todos.get('t1');
		expect(t?.title).toBe('Neu');
		expect(t?.due).toBe('2026-12-24 00:00:00.000Z');
	});

	it('an unchanged update keeps the object (no re-render)', () => {
		const before = store.todos.get('t1');
		const rec = mock.db.todos.find((t) => t.id === 't1')!;
		mock.emit('todos', 'update', rec);
		expect(store.todos.get('t1')).toBe(before);
	});

	it('deleted disappears', () => {
		mock.emit('todos', 'delete', todo('t3', 'l3', '2026-11-20'));
		expect(ids('u1')).toEqual(['t1']);
	});

	it('a to-do of a lead not seen before brings its lead (expand)', () => {
		leads.l9 = { id: 'l9', title: 'Neu', owner: 'u1', company: 'c3' };
		mock.emit('todos', 'create', todo('t9', 'l9', '2026-10-28'));
		expect(ids('u1')).toContain('t9');
		expect(store.lead('l9')?.title).toBe('Neu');
		delete leads.l9;
	});
});

describe('MyTodosStore: realtime leads (owner change)', () => {
	it('the lead is handed to me: its to-dos move into "mine"', () => {
		mock.emit('leads', 'update', { ...leads.l2, owner: 'u1' });
		expect(ids('u1')).toEqual(['t1', 't2', 't3']);
		expect(ids('u2')).toEqual([]);
	});

	it('my lead is handed to someone else: its to-dos leave "mine"', () => {
		mock.emit('leads', 'update', { ...leads.l1, owner: 'u2' });
		expect(ids('u1')).toEqual(['t3']);
		expect(ids('u2')).toEqual(['t1', 't2']);
	});

	it('the counter follows the owner change', () => {
		const now = new Date(2026, 9, 28, 10); // Wednesday, 28 Oct
		expect(countDue(store.list('u1'), now)).toEqual({ overdue: 1, today: 0 });
		mock.emit('leads', 'update', { ...leads.l2, owner: 'u1' });
		expect(countDue(store.list('u1'), now)).toEqual({ overdue: 1, today: 1 });
		mock.emit('leads', 'update', { ...leads.l1, owner: 'u2' });
		expect(countDue(store.list('u1'), now)).toEqual({ overdue: 0, today: 1 });
	});

	it('a renamed lead shows its new title', () => {
		mock.emit('leads', 'update', { ...leads.l1, title: 'Umbenannt' });
		expect(store.lead('l1')?.title).toBe('Umbenannt');
	});

	it('events of leads without loaded to-dos are ignored', () => {
		mock.emit('leads', 'update', { id: 'lx', title: 'x', owner: 'u1', company: 'c1' });
		expect(store.lead('lx')).toBeUndefined();
	});

	it('a deleted lead takes its to-dos with it (cascade), without waiting for their events', () => {
		mock.emit('leads', 'delete', leads.l1);
		expect(ids(null)).toEqual(['t2', 't3']);
		expect(store.lead('l1')).toBeUndefined();
	});

	it('an owner change during the first load is applied after it (buffered)', async () => {
		stop();
		const release = mock.hold('todos', 'getFullList');
		store = new MyTodosStore();
		stop = store.use();
		await flush();
		mock.emit('leads', 'update', { ...leads.l2, owner: 'u1' });
		release();
		await flush();
		expect(ids('u1')).toEqual(['t1', 't2', 't3']);
	});
});

describe('MyTodosStore: ticking off', () => {
	it('optimistic: gone at once, saved with done_at', async () => {
		const p = store.complete('t1');
		expect(ids('u1')).toEqual(['t3']);
		await p;
		expect(updates()).toHaveLength(1);
		const [id, data] = updates()[0].args as [string, { done: boolean; done_at: string }];
		expect(id).toBe('t1');
		expect(data.done).toBe(true);
		expect(data.done_at).not.toBe('');
		expect(store.error).toBe('');
	});

	it('the own realtime event afterwards changes nothing', async () => {
		await store.complete('t1');
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-10-20', { done: true }));
		expect(ids('u1')).toEqual(['t3']);
	});

	it('failure: it comes back with an error message', async () => {
		mock.fail('update', apiError(500, 'Serverfehler'), 'todos');
		await store.complete('t1');
		expect(ids('u1')).toEqual(['t1', 't3']);
		expect(store.error).not.toBe('');
	});

	it('failure after a newer realtime event: the event wins, no rollback', async () => {
		mock.fail('update', apiError(500), 'todos');
		const release = mock.hold('todos', 'update');
		const p = store.complete('t1');
		mock.emit('todos', 'update', todo('t1', 'l1', '2026-10-20', { done: true }));
		release();
		await p;
		expect(ids('u1')).toEqual(['t3']);
	});

	it('404 with a valid session: deleted by someone else, it stays gone without an error', async () => {
		mock.fail('update', apiError(404), 'todos');
		await store.complete('t1');
		expect(ids('u1')).toEqual(['t3']);
		expect(store.error).toBe('');
	});

	it('404 with an invalid session: logged out', async () => {
		mock.fail('update', apiError(404), 'todos');
		mock.invalidateSession();
		await store.complete('t1');
		expect(auth.loggedIn).toBe(false);
	});

	it('undo: back at once, saved as open again', async () => {
		const t = store.todos.get('t1')!;
		await store.complete('t1');
		const p = store.reopen(t);
		expect(ids('u1')).toEqual(['t1', 't3']);
		await p;
		const [id, data] = updates()[1].args as [string, { done: boolean; done_at: string }];
		expect(id).toBe('t1');
		expect(data).toEqual({ done: false, done_at: '' });
	});

	it('reports whether it was saved', async () => {
		expect(await store.complete('t1')).toBe(true);
		expect(await store.complete('t1')).toBe(false); // already gone: nothing sent
		expect(updates()).toHaveLength(1);
		expect(await store.complete('nope')).toBe(false);
		mock.fail('update', apiError(500), 'todos');
		expect(await store.complete('t3')).toBe(false);
		mock.fail('update', apiError(404), 'todos');
		expect(await store.complete('t2')).toBe(false); // deleted by someone else
	});

	it('undo while the tick-off is still being saved: sent after it, so it is not overtaken', async () => {
		const t = store.todos.get('t1')!;
		const release = mock.hold('todos', 'update');
		const done = store.complete('t1');
		await flush();
		const undo = store.reopen(t);
		await flush();
		expect(ids('u1')).toEqual(['t1', 't3']); // optimistic
		expect(updates()).toHaveLength(1); // the undo waits
		release();
		await Promise.all([done, undo]);
		const sent = updates().map((c) => (c.args[1] as { done: boolean }).done);
		expect(sent).toEqual([true, false]);
		expect(mock.db.todos.find((x) => x.id === 't1')?.done).toBe(false);
		expect(ids('u1')).toEqual(['t1', 't3']);
	});

	it('undo after a failed tick-off still reopens and keeps it', async () => {
		const t = store.todos.get('t1')!;
		mock.fail('update', apiError(500), 'todos');
		const release = mock.hold('todos', 'update');
		const done = store.complete('t1');
		await flush();
		const undo = store.reopen(t);
		release();
		expect(await done).toBe(false);
		await undo;
		expect(ids('u1')).toEqual(['t1', 't3']);
	});

	it('keeps no version entries once no write runs (no growth from realtime traffic)', async () => {
		for (let i = 0; i < 20; i++) mock.emit('todos', 'update', todo(`x${i}`, 'l1', '2026-10-28', { done: true }));
		mock.emit('todos', 'delete', todo('t3', 'l3', '2026-11-20'));
		expect(store.trackedVersions).toBe(0);
		const t = store.todos.get('t1')!;
		await store.complete('t1');
		expect(store.trackedVersions).toBe(0);
		await store.reopen(t);
		expect(store.trackedVersions).toBe(0);
		mock.fail('update', apiError(500), 'todos');
		await store.complete('t1');
		expect(store.trackedVersions).toBe(0);
	});

	it('undo fails: gone again, with an error message', async () => {
		const t = store.todos.get('t1')!;
		await store.complete('t1');
		mock.fail('update', apiError(500), 'todos');
		await store.reopen(t);
		expect(ids('u1')).toEqual(['t3']);
		expect(store.error).not.toBe('');
	});
});

describe('MyTodosStore: reconnect and lifetime', () => {
	it('reloads after a reconnect: missed changes appear, removed ones go', async () => {
		const t3 = mock.db.todos.find((t) => t.id === 't3')!;
		mock.set('todos', [
			todo('t1', 'l1', '2026-10-20', { done: true }), // ticked off while offline
			t3,
			todo('t6', 'l1', '2026-10-28') // created while offline
		]);
		const kept = store.todos.get('t3');
		mock.reconnect();
		await flush();
		expect(lists()).toHaveLength(2);
		expect(ids('u1')).toEqual(['t3', 't6']);
		expect(ids(null)).toEqual(['t3', 't6']);
		expect(store.todos.get('t3')).toBe(kept); // unchanged: same object
	});

	it('an owner change missed while offline is picked up by the reload', async () => {
		expect(ids('u1')).not.toContain('t2');
		mock.set('todos', [todo('t2', 'l2', '2026-10-28', { expand: { lead: { ...leads.l2, owner: 'u1' } } })]);
		mock.reconnect();
		await flush();
		expect(ids('u1')).toEqual(['t2']);
	});

	it('page and counter share one source: one query, one subscription each', async () => {
		const second = store.use();
		await flush();
		expect(lists()).toHaveLength(1);
		expect(mock.subscriberCount('todos')).toBe(1);
		expect(mock.subscriberCount('leads')).toBe(1);
		second(); // the page goes, the counter stays
		expect(mock.subscriberCount('todos')).toBe(1);
		expect(ids(null)).toHaveLength(3);
	});

	it('when the last user goes (logout), it unsubscribes and forgets the data', async () => {
		stop();
		await flush();
		expect(mock.subscriberCount('todos')).toBe(0);
		expect(mock.subscriberCount('leads')).toBe(0);
		expect(store.list(null)).toEqual([]);
		expect(store.loaded).toBe(false);
		// used again (next login): loads anew
		stop = store.use();
		await flush();
		expect(lists()).toHaveLength(2);
		expect(ids(null)).toEqual(['t1', 't2', 't3']);
	});
});
