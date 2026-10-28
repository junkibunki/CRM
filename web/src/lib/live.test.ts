import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { auth } from './auth.svelte';
import { liveSync } from './live';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

let cleanup: (() => void)[] = [];

beforeEach(() => {
	auth.logout(); // forget the last session check (a first load may reuse it)
	mock.reset();
	mock.set('items', [{ id: 'x', v: 1 }]);
});

afterEach(() => {
	cleanup.forEach((fn) => fn());
	cleanup = [];
});

function setup() {
	const applied: { data: unknown; first: boolean }[] = [];
	const events: string[] = [];
	const errors: unknown[] = [];
	const stop = liveSync({
		subscribe: (handle) => [
			mock.pb.collection('items').subscribe('*', (e) => handle(() => events.push(e.record.id)))
		],
		fetch: () => mock.pb.collection('items').getFullList(),
		apply: (data, first) => applied.push({ data, first }),
		onError: (err) => errors.push(err)
	});
	cleanup.push(stop);
	return { applied, events, errors, stop };
}

describe('liveSync', () => {
	it('subscribes first, then loads once (first = true)', async () => {
		const s = setup();
		await flush();
		expect(s.applied).toHaveLength(1);
		expect(s.applied[0].first).toBe(true);
		const order = mock.calls.filter((c) => c.collection === 'items').map((c) => c.method);
		expect(order.indexOf('subscribe')).toBeLessThan(order.indexOf('getFullList'));
		s.stop();
	});

	it('buffers events during a load and replays them after apply, in order', async () => {
		const release = mock.hold('items', 'getFullList');
		const s = setup();
		await flush();
		mock.emit('items', 'create', { id: 'e1' });
		mock.emit('items', 'update', { id: 'e2' });
		expect(s.events).toEqual([]); // still loading
		release();
		await flush();
		expect(s.applied).toHaveLength(1);
		expect(s.events).toEqual(['e1', 'e2']);
		mock.emit('items', 'create', { id: 'e3' });
		expect(s.events).toEqual(['e1', 'e2', 'e3']); // live afterwards
		s.stop();
	});

	it('reloads after a reconnect (first = false)', async () => {
		const s = setup();
		await flush();
		mock.reconnect();
		await flush();
		expect(s.applied.map((a) => a.first)).toEqual([true, false]);
		s.stop();
	});

	it('retries after a failed first load once the connection comes back', async () => {
		mock.fail('getFullList', apiError(0, 'offline'), 'items');
		const s = setup();
		await flush();
		expect(s.errors).toHaveLength(1);
		expect(s.applied).toHaveLength(0);
		mock.reconnect();
		await flush();
		expect(s.applied).toEqual([expect.objectContaining({ first: true })]);
		s.stop();
	});

	it('only applies the latest of overlapping loads', async () => {
		const s = setup();
		await flush();
		const releaseFirst = mock.hold('items', 'getFullList');
		mock.reconnect(); // load #2, held
		await flush();
		mock.set('items', [{ id: 'x', v: 3 }]);
		mock.reconnect(); // load #3, runs through
		await flush();
		releaseFirst(); // #2 finishes last but is stale
		await flush();
		const reloads = s.applied.filter((a) => !a.first);
		expect(reloads).toHaveLength(1);
		expect(reloads[0].data).toEqual([{ id: 'x', v: 3 }]); // not the stale v1 of load #2
		// both reloads really ran (a "skip while busy" implementation would only fetch once)
		expect(mock.calls.filter((c) => c.method === 'getFullList')).toHaveLength(3);
		s.stop();
	});

	it('checks the session before loading and does not fetch with an invalid one', async () => {
		mock.invalidateSession();
		const s = setup();
		await flush();
		expect(s.applied).toHaveLength(0);
		expect(mock.calls.filter((c) => c.method === 'getFullList')).toHaveLength(0);
		expect(mock.pb.authStore.token).toBe(''); // logged out
		s.stop();
	});

	it('reuses a session check from moments ago for a first load (no extra round-trip)', async () => {
		const refreshes = () => mock.calls.filter((c) => c.method === 'authRefresh').length;
		const a = setup(); // e.g. the board lookup of the leads page
		await flush();
		expect(refreshes()).toBe(1);
		const b = setup(); // then the board itself, started after the lookup
		await flush();
		expect(b.applied).toHaveLength(1);
		expect(refreshes()).toBe(1);
		a.stop();
		b.stop();
	});

	it('still checks the session before a reload after a reconnect', async () => {
		const s = setup();
		await flush();
		mock.invalidateSession();
		mock.reconnect();
		await flush();
		expect(s.applied).toHaveLength(1); // no reload with the invalid session
		expect(mock.pb.authStore.token).toBe('');
		s.stop();
	});

	it('keeps successful subscriptions for teardown when another one fails', async () => {
		mock.fail('subscribe', apiError(500, 'boom'), 'broken');
		const errors: unknown[] = [];
		const stop = liveSync({
			subscribe: () => [
				mock.pb.collection('items').subscribe('*', () => {}),
				mock.pb.collection('broken').subscribe('*', () => {})
			],
			fetch: async () => null,
			apply: () => {},
			onError: (e) => errors.push(e)
		});
		await flush();
		expect(errors).toHaveLength(1);
		const before = mock.subscriberCount('items');
		stop();
		await flush();
		expect(mock.subscriberCount('items')).toBe(before - 1);
	});

	it('stops delivering after teardown', async () => {
		const s = setup();
		await flush();
		s.stop();
		await flush();
		mock.emit('items', 'create', { id: 'late' });
		expect(s.events).toEqual([]);
	});
});
