import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.TZ = 'Europe/Berlin';
});

import { flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import { firstLine, isNewer, relativeDay, type LastActivity } from './format';
import { LastActivityStore } from './last.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { filter?: string; fields?: string };
let listOptions: { collection: string; opts: Opts }[];
let subscribeOptions: { collection: string; opts: Opts }[];
/** when set, the next getList on the view waits for it (an overtaken re-read) */
let getListGate: Promise<void> | null = null;

const act = (id: string, lead: string, occurred: string, extra: Partial<LastActivity> = {}): LastActivity => ({
	id,
	lead,
	type: 'note',
	subject: `Betreff ${id}`,
	body: '',
	occurred_at: `${occurred} 10:00:00.000Z`,
	created: stamp(),
	...extra
});

/** latest per lead, like the view does */
function viewRows(all: LastActivity[]) {
	const best = new Map<string, LastActivity>();
	for (const a of all) {
		const cur = best.get(a.lead);
		if (!cur || isNewer(a, cur)) best.set(a.lead, a);
	}
	return [...best.values()];
}

/** the shared mock has no views: compute `lead_last_activity` from `activities` */
function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		const activities = () => (mock.db.activities ?? []) as unknown as LastActivity[];
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions.push({ collection: name, opts });
				if (name === 'lead_last_activity') return JSON.parse(JSON.stringify(viewRows(activities())));
				return c.getFullList();
			},
			async getList(_page: number, _perPage: number, opts: Opts = {}) {
				listOptions.push({ collection: name, opts });
				if (getListGate) {
					const gate = getListGate;
					getListGate = null;
					await gate;
				}
				const m = /^lead = "(.*)"$/.exec(opts.filter ?? '');
				const rows = viewRows(activities()).filter((a) => !m || a.lead === m[1]);
				return { items: JSON.parse(JSON.stringify(rows.slice(0, 1))) };
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions.push({ collection: name, opts: opts ?? {} });
				return c.subscribe(topic, cb);
			}
		};
	});
}

let store: LastActivityStore;
let stop: () => void;
const latestId = (lead: string) => store.of(lead)?.id;

/** server-side change + its realtime event */
function change(action: 'create' | 'update' | 'delete', rec: LastActivity) {
	const list = (mock.db.activities ??= []);
	const i = list.findIndex((r) => r.id === rec.id);
	if (i !== -1) list.splice(i, 1);
	if (action !== 'delete') list.push({ ...rec });
	mock.emit('activities', action, rec);
}

afterEach(() => {
	stop?.();
	vi.restoreAllMocks();
});

beforeEach(async () => {
	auth.logout();
	mock.reset();
	listOptions = [];
	subscribeOptions = [];
	getListGate = null;
	wrapCollections();
	mock.set('activities', [
		act('a1', 'l1', '2026-10-01'),
		act('a2', 'l1', '2026-10-20'),
		act('a3', 'l1', '2026-10-10'),
		act('b1', 'l2', '2026-09-01')
	]);
	store = new LastActivityStore('b1');
	stop = store.sync();
	await flush();
	listOptions.length = 0;
});

describe('LastActivityStore: loading', () => {
	it('loads the latest activity of every lead with ONE query on the view', async () => {
		stop();
		listOptions = [];
		store = new LastActivityStore('b1');
		stop = store.sync();
		await flush();
		expect(listOptions).toHaveLength(1);
		expect(listOptions[0].collection).toBe('lead_last_activity');
		expect(listOptions[0].opts.filter).toBe('lead.column.board = "b1"');
		expect(listOptions[0].opts.fields).toContain('body:excerpt(');
		expect(store.loaded).toBe(true);
		expect(latestId('l1')).toBe('a2');
		expect(latestId('l2')).toBe('b1');
		expect(store.of('l3')).toBeUndefined();
	});

	it('follows the activities of the pipeline (excerpt, not the HTML body)', () => {
		const sub = subscribeOptions.find((s) => s.collection === 'activities')!;
		expect(sub.opts.filter).toBe('lead.column.board = "b1"');
		expect(sub.opts.fields).toContain('body:excerpt(');
	});
});

describe('LastActivityStore: realtime', () => {
	it('a newer activity replaces the entry without a request', () => {
		change('create', act('a4', 'l1', '2026-10-25'));
		expect(latestId('l1')).toBe('a4');
		expect(listOptions).toHaveLength(0);
	});

	it('an older activity (entered later) changes nothing', () => {
		const before = store.of('l1');
		change('create', act('a5', 'l1', '2026-09-01'));
		expect(store.of('l1')).toBe(before);
	});

	it('a new subject of the latest one shows', () => {
		change('update', { ...store.of('l1')!, subject: 'Neu' });
		expect(store.of('l1')?.subject).toBe('Neu');
	});

	it('deleting the latest one re-reads just that lead: the previous one moves up', async () => {
		change('delete', act('a2', 'l1', '2026-10-20'));
		await flush();
		expect(latestId('l1')).toBe('a3');
		expect(listOptions).toHaveLength(1);
		expect(listOptions[0].opts.filter).toBe('lead = "l1"');
	});

	it('deleting the only one leaves the lead without', async () => {
		change('delete', act('b1', 'l2', '2026-09-01'));
		await flush();
		expect(store.of('l2')).toBeUndefined();
	});

	it('deleting an older one needs no request', async () => {
		change('delete', act('a1', 'l1', '2026-10-01'));
		await flush();
		expect(latestId('l1')).toBe('a2');
		expect(listOptions).toHaveLength(0);
	});

	it('the latest one moved back in time: re-read finds the one that is now latest', async () => {
		change('update', act('a2', 'l1', '2026-09-15'));
		await flush();
		expect(latestId('l1')).toBe('a3');
	});

	it('an activity moved to another lead leaves the old lead', async () => {
		change('update', act('a2', 'l2', '2026-10-20'));
		await flush();
		expect(latestId('l2')).toBe('a2');
		expect(latestId('l1')).toBe('a3');
	});

	it('a re-read overtaken by a newer event reads again', async () => {
		let open!: () => void;
		getListGate = new Promise<void>((r) => (open = r));
		change('delete', act('a2', 'l1', '2026-10-20')); // re-read 1 hangs
		await flush();
		change('create', act('a0', 'l1', '2026-08-01')); // older, but the entry is empty meanwhile
		expect(latestId('l1')).toBe('a0'); // tentative
		open();
		await flush();
		expect(listOptions.filter((o) => o.opts.filter === 'lead = "l1"').length).toBeGreaterThanOrEqual(2);
		expect(latestId('l1')).toBe('a3');
	});

	it('reloads after a reconnect; unchanged entries keep their object', async () => {
		const kept = store.of('l2');
		mock.db.activities = mock.db.activities.filter((a) => a.id !== 'a2');
		mock.reconnect();
		await flush();
		expect(latestId('l1')).toBe('a3');
		expect(store.of('l2')).toBe(kept);
	});
});

describe('format', () => {
	const now = new Date(2026, 9, 28, 9, 0);
	it('relative days in local time', () => {
		expect(relativeDay('2026-10-28 08:00:00.000Z', now)).toBe('heute');
		expect(relativeDay('2026-10-27 23:30:00.000Z', now)).toBe('heute'); // 00:30 on 28 Oct in Berlin
		expect(relativeDay('2026-10-27 22:30:00.000Z', now)).toBe('gestern'); // 23:30 on 27 Oct
	});
	it('counts calendar days, weeks, months, years', () => {
		expect(relativeDay('2026-10-27 12:00:00.000Z', now)).toBe('gestern');
		expect(relativeDay('2026-10-25 12:00:00.000Z', now)).toBe('vor 3 Tagen');
		expect(relativeDay('2026-10-07 12:00:00.000Z', now)).toBe('vor 3 Wochen');
		expect(relativeDay('2026-07-01 12:00:00.000Z', now)).toBe('vor 3 Monaten');
		expect(relativeDay('2024-10-01 12:00:00.000Z', now)).toBe('vor 2 Jahren');
		expect(relativeDay('2026-10-29 12:00:00.000Z', now)).toBe('morgen');
		expect(relativeDay('', now)).toBe('');
	});
	it('first line: subject, else the excerpt in one line', () => {
		expect(firstLine({ subject: ' Erstkontakt ', body: 'x' })).toBe('Erstkontakt');
		expect(firstLine({ subject: '', body: 'Agenda\n Punkt eins' })).toBe('Agenda Punkt eins');
	});
	it('newer: by time, then entry time, then id', () => {
		const a = { occurred_at: '2026-10-02', created: '1', id: 'a' };
		expect(isNewer(a, { ...a, occurred_at: '2026-10-01' })).toBe(true);
		expect(isNewer(a, { ...a, created: '0' })).toBe(true);
		expect(isNewer(a, { ...a, id: 'b' })).toBe(false);
	});
});
