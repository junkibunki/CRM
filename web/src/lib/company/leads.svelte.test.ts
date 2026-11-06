import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import { LEAD_FIELDS, STAGE_FIELDS } from './leads';
import { CompanyLeadsStore } from './leads.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Opts = { fields?: string };
let listOptions: Record<string, Opts>;
let subscribeOptions: Record<string, Opts>;

function wrapCollections() {
	const real = mock.pb.collection;
	vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
		const c = real(name);
		return {
			...c,
			async getFullList(opts: Opts = {}) {
				listOptions[name] = opts;
				return c.getFullList();
			},
			async subscribe(topic: string, cb: Parameters<typeof c.subscribe>[1], opts?: Opts) {
				subscribeOptions[name] = opts ?? {};
				return c.subscribe(topic, cb);
			}
		};
	});
}

const lead = (id: string, company: string, column: string, created = '2026-01-01 10:00:00.000Z') => ({
	id,
	title: `Lead ${id}`,
	company,
	column,
	owner: 'u1',
	expected_close: '',
	created,
	collectionId: 'x'
});

let store: CompanyLeadsStore;
let stop: () => void;

beforeEach(async () => {
	auth.logout();
	mock.reset();
	listOptions = {};
	subscribeOptions = {};
	wrapCollections();
	mock.set('board_columns', [
		{ id: 'open', board: 'b1', name: 'Neu', color: 'blue', closed: false, rank: 'a' },
		{ id: 'won', board: 'b1', name: 'Gewonnen', color: 'green', closed: true, rank: 'b' }
	]);
	mock.set('leads', [lead('l1', 'c1', 'open'), lead('l2', 'c1', 'won'), lead('l3', 'c2', 'open')]);
	store = new CompanyLeadsStore();
	stop = store.use();
	await flush();
});

afterEach(() => {
	stop?.();
	vi.restoreAllMocks();
});

describe('CompanyLeadsStore: loading', () => {
	it('loads leads and stages with few fields and counts active leads per company', () => {
		expect(store.loaded).toBe(true);
		expect(listOptions.leads.fields).toBe(LEAD_FIELDS);
		expect(listOptions.board_columns.fields).toBe(STAGE_FIELDS);
		expect(subscribeOptions.leads.fields).toBe(LEAD_FIELDS);
		expect(subscribeOptions.board_columns.fields).toBe(STAGE_FIELDS);
		expect(store.activeCounts.get('c1')).toBe(1);
		expect(store.activeCounts.get('c2')).toBe(1);
	});

	it('keeps only its own fields of a record', () => {
		expect(store.leads.get('l1')).not.toHaveProperty('collectionId');
	});

	it('ofCompany splits active and closed', () => {
		const r = store.ofCompany('c1');
		expect(r.active.map((l) => l.id)).toEqual(['l1']);
		expect(r.closed.map((l) => l.id)).toEqual(['l2']);
	});

	it('a failed load shows the error and still counts as settled', async () => {
		stop();
		mock.fail('getFullList', apiError(500, 'kaputt'), 'leads');
		store = new CompanyLeadsStore();
		stop = store.use();
		await flush();
		expect(store.error).not.toBe('');
		expect(store.loaded).toBe(true);
		// the reload after the reconnect works: error gone, data there
		mock.reconnect();
		await flush();
		expect(store.error).toBe('');
		expect(store.activeCounts.get('c1')).toBe(1);
	});

	it('an event arriving while the load runs is applied after it', async () => {
		stop();
		const release = mock.hold('leads', 'getFullList');
		store = new CompanyLeadsStore();
		stop = store.use();
		await flush();
		mock.emit('leads', 'create', lead('l4', 'c2', 'open'));
		expect(store.leads.has('l4')).toBe(false); // buffered
		release();
		await flush();
		expect(store.activeCounts.get('c2')).toBe(2);
	});
});

describe('CompanyLeadsStore: realtime', () => {
	it('a new lead counts at once; its own create event twice does not double it', () => {
		mock.emit('leads', 'create', lead('l4', 'c2', 'open'));
		mock.emit('leads', 'create', lead('l4', 'c2', 'open'));
		expect(store.activeCounts.get('c2')).toBe(2);
	});

	it('moving a lead into a closed stage takes it out of the count', () => {
		mock.emit('leads', 'update', lead('l1', 'c1', 'won'));
		expect(store.activeCounts.has('c1')).toBe(false);
		expect(store.ofCompany('c1').closed.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
	});

	it('a lead moved to another company counts there', () => {
		mock.emit('leads', 'update', lead('l3', 'c1', 'open'));
		expect(store.activeCounts.get('c1')).toBe(2);
		expect(store.activeCounts.has('c2')).toBe(false);
	});

	it('a deleted lead is gone', () => {
		mock.emit('leads', 'delete', lead('l3', 'c2', 'open'));
		expect(store.activeCounts.has('c2')).toBe(false);
	});

	it('a stage marked closed changes the count of all its leads', () => {
		mock.emit('board_columns', 'update', {
			id: 'open',
			board: 'b1',
			name: 'Neu',
			color: 'blue',
			closed: true,
			rank: 'a'
		});
		expect(store.activeCounts.size).toBe(0);
	});

	it('a deleted stage takes its leads with it (cascade), without waiting for their events', () => {
		mock.emit('board_columns', 'delete', { id: 'open' });
		expect(store.leads.has('l1')).toBe(false);
		expect(store.leads.has('l3')).toBe(false);
		expect(store.leads.has('l2')).toBe(true);
	});

	it('an unchanged record keeps its object', () => {
		const before = store.leads.get('l1');
		mock.emit('leads', 'update', lead('l1', 'c1', 'open'));
		expect(store.leads.get('l1')).toBe(before);
	});

	it('reloads after a reconnect (missed events)', async () => {
		mock.set('leads', [lead('l1', 'c1', 'open'), lead('l5', 'c3', 'open')]);
		mock.reconnect();
		await flush();
		expect(store.leads.has('l2')).toBe(false);
		expect(store.activeCounts.get('c3')).toBe(1);
	});
});

describe('CompanyLeadsStore: ref-counting', () => {
	it('one subscription for several users; the last one ends it but keeps the data (no flicker)', async () => {
		const stop2 = store.use();
		await flush();
		expect(mock.subscriberCount('leads')).toBe(1);
		stop2();
		stop();
		await flush();
		expect(mock.subscriberCount('leads')).toBe(0);
		expect(store.leads.size).toBe(3);
		expect(store.loaded).toBe(true);
	});

	it('the next use() reloads and replaces what changed meanwhile', async () => {
		stop();
		await flush();
		mock.set('leads', [lead('l9', 'c9', 'open')]);
		stop = store.use();
		await flush();
		expect([...store.leads.keys()]).toEqual(['l9']);
		expect(store.activeCounts.get('c9')).toBe(1);
	});
});
