import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { ActivityStore } from './activities.svelte';
import type { Activity, ActivityData } from './types';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { filter?: string; sort?: string };
let listOptions: Opts[];
let subscribeOptions: { collection: string; topic: string; opts?: Opts }[];
let sent: { method: string; data: Record<string, unknown> }[];

const fileName = (f: unknown) => (f as File).name;

/**
 * The shared mock ignores list filters and can't clone File objects: wrap it to apply
 * `lead = "…"`, record the options, and emulate `attachments` / `attachments+` / `-`.
 */
function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions.push(opts);
				const all = (await c.getFullList()) as Activity[];
				const m = /^lead = "(.*)"$/.exec(opts.filter ?? '');
				return m ? all.filter((a) => a.lead === m[1]) : all;
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions.push({ collection: name, topic, opts });
				return c.subscribe(topic, cb);
			},
			async create(data: Record<string, unknown>) {
				sent.push({ method: 'create', data });
				const files = (data.attachments as unknown[] | undefined)?.map(fileName) ?? [];
				return c.create({ contacts: [], ...data, attachments: files });
			},
			async update(id: string, data: Record<string, unknown>) {
				sent.push({ method: 'update', data });
				const { 'attachments+': add, 'attachments-': remove, ...rest } = data;
				if (add || remove) {
					const cur = (mock.db[name] ?? []).find((r) => r.id === id) as Activity | undefined;
					const names = (cur?.attachments ?? []).filter((n) => !(remove as string[] | undefined)?.includes(n));
					rest.attachments = [...names, ...((add as unknown[] | undefined) ?? []).map(fileName)];
				}
				return c.update(id, rest);
			}
		};
	});
}

function act(id: string, lead: string, occurred: string, extra: Partial<Activity> = {}): Activity {
	const t = stamp();
	return {
		id,
		lead,
		type: 'note',
		subject: '',
		body: `<p>${id}</p>`,
		occurred_at: occurred,
		contacts: [],
		attachments: [],
		author: 'u1',
		created: t,
		updated: t,
		collectionId: 'act',
		collectionName: 'activities',
		...extra
	};
}

const lead = (id: string, contacts: string[] = ['c1']) => ({
	id,
	title: `Lead ${id}`,
	contacts,
	updated: stamp(),
	collectionId: 'leads',
	collectionName: 'leads'
});

const data = (a: Activity): ActivityData => ({
	type: a.type,
	subject: a.subject,
	body: a.body,
	occurred_at: a.occurred_at,
	contacts: [...a.contacts]
});

let store: ActivityStore;
let stop: () => void;
const ids = () => store.list.map((a) => a.id);
// $state proxies can't be structuredClone'd by the mock: hand it a plain copy
const snap = (id: string): Activity => JSON.parse(JSON.stringify(store.get(id)));

beforeEach(() => {
	mock.reset();
	listOptions = [];
	subscribeOptions = [];
	sent = [];
	wrapCollections();
	mock.set('leads', [lead('L1'), lead('L2')]);
	mock.set('activities', [
		act('a1', 'L1', '2026-10-01 10:00:00.000Z'),
		act('a2', 'L1', '2026-10-03 10:00:00.000Z', { type: 'email_in' }),
		act('a3', 'L1', '2026-10-02 10:00:00.000Z', { type: 'meeting' }),
		act('x1', 'L2', '2026-10-05 10:00:00.000Z')
	]);
	store = new ActivityStore('L1');
});

afterEach(() => stop?.());

async function start() {
	stop = store.sync();
	await flush();
}

describe('ActivityStore: loading', () => {
	it("loads only this lead's activities, newest first, and the lead", async () => {
		await start();
		expect(store.loaded).toBe(true);
		expect(ids()).toEqual(['a2', 'a3', 'a1']);
		expect(store.lead?.id).toBe('L1');
		expect(listOptions[0].filter).toBe('lead = "L1"');
	});

	it('subscribes to this lead only (activities filtered, the lead by id)', async () => {
		await start();
		expect(subscribeOptions).toContainEqual({ collection: 'activities', topic: '*', opts: { filter: 'lead = "L1"' } });
		expect(subscribeOptions.some((s) => s.collection === 'leads' && s.topic === 'L1')).toBe(true);
	});

	it('marks the lead as gone when it does not exist', async () => {
		store = new ActivityStore('nope');
		await start();
		expect(store.gone).toBe(true);
		expect(store.error).toBe('');
	});

	it('shows a load error other than 404', async () => {
		mock.fail('getFullList', apiError(500, 'kaputt'), 'activities');
		await start();
		expect(store.error).toBe('kaputt');
		expect(store.loaded).toBe(true);
	});

	it('replays events that arrive during the load', async () => {
		const release = mock.hold('activities', 'getFullList');
		stop = store.sync();
		await flush();
		mock.emit('activities', 'create', act('a4', 'L1', '2026-10-04 10:00:00.000Z'));
		mock.emit('activities', 'delete', act('a1', 'L1', '2026-10-01 10:00:00.000Z'));
		release();
		await flush();
		expect(ids()).toEqual(['a4', 'a2', 'a3']);
	});

	it('reloads after a reconnect and keeps unchanged records as they are', async () => {
		await start();
		const before = store.get('a3');
		// missed while disconnected: a2 edited, a1 deleted, a5 created
		const db = mock.db.activities as Activity[];
		Object.assign(db.find((a) => a.id === 'a2')!, { subject: 'neu', updated: stamp() });
		mock.db.activities = db.filter((a) => a.id !== 'a1');
		mock.db.activities.push(act('a5', 'L1', '2026-09-01 10:00:00.000Z'));
		mock.reconnect();
		await flush();
		expect(ids()).toEqual(['a2', 'a3', 'a5']);
		expect(store.get('a2')?.subject).toBe('neu');
		expect(store.get('a3')).toBe(before);
	});
});

describe('ActivityStore: realtime', () => {
	it('inserts, moves and removes records in date order', async () => {
		await start();
		mock.emit('activities', 'create', act('a4', 'L1', '2026-10-02 12:00:00.000Z'));
		expect(ids()).toEqual(['a2', 'a4', 'a3', 'a1']);
		
		mock.emit('activities', 'update', { ...snap('a1'), occurred_at: '2026-10-09 08:00:00.000Z', updated: stamp() });
		expect(ids()).toEqual(['a1', 'a2', 'a4', 'a3']);
		mock.emit('activities', 'delete', snap('a4'));
		expect(ids()).toEqual(['a1', 'a2', 'a3']);
	});

	it("ignores other leads' activities and drops one moved to another lead", async () => {
		await start();
		mock.emit('activities', 'create', act('x2', 'L2', '2026-10-09 10:00:00.000Z'));
		expect(ids()).not.toContain('x2');
		mock.emit('activities', 'update', { ...snap('a1'), lead: 'L2', updated: stamp() });
		expect(ids()).toEqual(['a2', 'a3']);
	});

	it('ignores an event older than the version it has', async () => {
		await start();
		const old = snap('a2');
		mock.emit('activities', 'update', { ...old, subject: 'neuer', updated: stamp() });
		mock.emit('activities', 'update', { ...old, subject: 'älter' });
		expect(store.get('a2')?.subject).toBe('neuer');
	});

	it('follows changes of the lead and notices its deletion', async () => {
		await start();
		mock.emit('leads', 'update', { ...lead('L1', ['c1', 'c2']) });
		expect(store.lead?.contacts).toEqual(['c1', 'c2']);
		mock.emit('leads', 'update', { ...lead('L2', ['c9']) });
		expect(store.lead?.contacts).toEqual(['c1', 'c2']);
		mock.emit('leads', 'delete', lead('L1'));
		expect(store.gone).toBe(true);
		expect(store.lead).toBeNull();
	});
});

describe('ActivityStore: filter', () => {
	it('filters by type; e-mails cover both directions', async () => {
		mock.db.activities.push(act('a6', 'L1', '2026-09-01 10:00:00.000Z', { type: 'email_out' }));
		await start();
		expect(store.visible('all').map((a) => a.id)).toEqual(['a2', 'a3', 'a1', 'a6']);
		expect(store.visible('note').map((a) => a.id)).toEqual(['a1']);
		expect(store.visible('meeting').map((a) => a.id)).toEqual(['a3']);
		expect(store.visible('email').map((a) => a.id)).toEqual(['a2', 'a6']);
	});
});

describe('ActivityStore: create', () => {
	const input: ActivityData = {
		type: 'meeting',
		subject: 'Kick-off',
		body: '<p>Protokoll</p>',
		occurred_at: '2026-10-04 09:00:00.000Z',
		contacts: ['c1']
	};

	it('creates for this lead as the current user and shows it once', async () => {
		await start();
		const rec = await store.create(input);
		expect(sent[0].data).toEqual({ ...input, lead: 'L1', author: 'u1' });
		mock.emit('activities', 'create', rec);
		expect(ids()).toEqual([rec.id, 'a2', 'a3', 'a1']);
	});

	it('also when the realtime event comes before the response', async () => {
		await start();
		const hold = mock.hold('activities', 'create');
		const pending = store.create(input);
		await flush();
		hold();
		// the event is delivered while the response is still on its way
		const rec = await pending.then((r) => {
			mock.emit('activities', 'create', r);
			return r;
		});
		expect(ids().filter((id) => id === rec.id)).toHaveLength(1);
	});

	it('uploads files as attachments', async () => {
		await start();
		const files = [new File(['a'], 'eins.pdf'), new File(['b'], 'zwei.png')];
		const rec = await store.create(input, files);
		expect(sent[0].data.attachments).toEqual(files);
		expect(rec.attachments).toEqual(['eins.pdf', 'zwei.png']);
	});

	it('throws on failure and adds nothing', async () => {
		await start();
		mock.fail('create', apiError(400, 'Failed to create record.', { body: { code: 'validation_required', message: 'Pflicht' } }));
		await expect(store.create(input)).rejects.toBeTruthy();
		expect(ids()).toEqual(['a2', 'a3', 'a1']);
	});
});

describe('ActivityStore: update', () => {
	it('sends only the changed fields', async () => {
		await start();
		const a = store.get('a3')!;
		const initial = data(a);
		const rec = await store.update('a3', initial, { ...initial, subject: 'Neu', contacts: ['c2'] });
		expect(sent).toEqual([{ method: 'update', data: { subject: 'Neu', contacts: ['c2'] } }]);
		expect(rec?.subject).toBe('Neu');
		expect(store.get('a3')?.subject).toBe('Neu');
	});

	it('keeps fields another user changed meanwhile', async () => {
		await start();
		const initial = data(store.get('a3')!);
		// someone else changes the body while our form is open
		const db = mock.db.activities as Activity[];
		Object.assign(db.find((a) => a.id === 'a3')!, { body: '<p>fremd</p>', updated: stamp() });
		await store.update('a3', initial, { ...initial, subject: 'unseres' });
		expect(store.get('a3')).toMatchObject({ subject: 'unseres', body: '<p>fremd</p>' });
	});

	it('sends nothing if nothing changed', async () => {
		await start();
		const initial = data(store.get('a1')!);
		expect(await store.update('a1', initial, { ...initial, contacts: [...initial.contacts] })).toBeNull();
		expect(sent).toEqual([]);
	});

	it('adds and removes attachments with the + / - modifiers', async () => {
		(mock.db.activities as Activity[])[0].attachments = ['alt_abcdefghij.pdf', 'bleibt_abcdefghij.pdf'];
		await start();
		const initial = data(store.get('a1')!);
		const file = new File(['x'], 'neu.pdf');
		await store.update('a1', initial, initial, [file], ['alt_abcdefghij.pdf']);
		expect(sent[0].data).toEqual({ 'attachments+': [file], 'attachments-': ['alt_abcdefghij.pdf'] });
		expect(store.get('a1')?.attachments).toEqual(['bleibt_abcdefghij.pdf', 'neu.pdf']);
	});

	it('keeps a newer realtime version over an older response', async () => {
		await start();
		const initial = data(store.get('a1')!);
		const hold = mock.hold('activities', 'update');
		const pending = store.update('a1', initial, { ...initial, subject: 'unseres' });
		await flush();
		mock.emit('activities', 'update', { ...snap('a1'), subject: 'neuer', updated: '2999-01-01 00:00:00.000000Z' });
		hold();
		await pending;
		expect(store.get('a1')?.subject).toBe('neuer');
	});

	it('does not resurrect an activity deleted meanwhile', async () => {
		await start();
		const initial = data(store.get('a1')!);
		const hold = mock.hold('activities', 'update');
		const pending = store.update('a1', initial, { ...initial, subject: 'x' });
		await flush();
		mock.emit('activities', 'delete', snap('a1'));
		hold();
		await pending;
		expect(store.get('a1')).toBeUndefined();
	});
});

describe('ActivityStore: delete', () => {
	it('deletes and removes it', async () => {
		await start();
		expect(await store.remove('a2')).toBe(true);
		expect(ids()).toEqual(['a3', 'a1']);
		expect((mock.db.activities as Activity[]).some((a) => a.id === 'a2')).toBe(false);
	});

	it('treats "already deleted by someone else" as done', async () => {
		await start();
		mock.fail('delete', apiError(404, 'not found'), 'activities');
		expect(await store.remove('a2')).toBe(true);
		expect(ids()).toEqual(['a3', 'a1']);
		expect(store.error).toBe('');
	});

	it('keeps it and shows the error when the delete fails', async () => {
		await start();
		mock.fail('delete', apiError(500, 'Serverfehler'), 'activities');
		expect(await store.remove('a2')).toBe(false);
		expect(ids()).toEqual(['a2', 'a3', 'a1']);
		expect(store.error).toBe('Serverfehler');
	});

	it('logs out instead when the session became invalid (guest 404)', async () => {
		await start();
		mock.fail('delete', apiError(404, 'not found'), 'activities');
		mock.invalidateSession();
		expect(await store.remove('a2')).toBe(false);
		expect(mock.pb.authStore.token).toBe('');
		expect(ids()).toContain('a2');
	});
});
