import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import { auth } from '../auth.svelte';
import * as pbModule from '../pb';
import type { ApiToken } from './format';
import { TokenStore } from './tokens.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;
const pb = mock.pb as unknown as { send: (path: string, opts: unknown) => Promise<unknown> };

const tok = (id: string, created: string, extra: Partial<ApiToken> = {}): ApiToken => ({
	id,
	user: 'u1',
	name: `Token ${id}`,
	last_used: '',
	created,
	updated: created,
	...extra
});

let send: ReturnType<typeof vi.fn>;

beforeEach(() => {
	auth.logout();
	mock.reset();
	mock.set('api_tokens', [tok('a', '2026-01-01 00:00:00.000Z'), tok('b', '2026-02-01 00:00:00.000Z')]);
	mock.set('users', [{ id: 'u1', name: 'Test User' }]);
	send = vi.fn();
	pb.send = send as unknown as typeof pb.send;
});

async function started() {
	const store = new TokenStore();
	const stop = store.use();
	await flush();
	return { store, stop };
}

describe('TokenStore', () => {
	it('loads the own tokens newest first and subscribes', async () => {
		const { store, stop } = await started();
		expect(store.loaded).toBe(true);
		expect(store.items.map((t) => t.id)).toEqual(['b', 'a']);
		expect(mock.subscriberCount('api_tokens')).toBe(1);
		stop();
		expect(mock.subscriberCount('api_tokens')).toBe(0);
	});

	it('never shows tokens of someone else (defensive, the rules already filter)', async () => {
		mock.set('api_tokens', [tok('a', '2026-01-01 00:00:00.000Z'), tok('x', '2026-03-01 00:00:00.000Z', { user: 'u2' })]);
		const { store, stop } = await started();
		expect(store.items.map((t) => t.id)).toEqual(['a']);
		mock.emit('api_tokens', 'create', tok('y', '2026-04-01 00:00:00.000Z', { user: 'u2' }));
		expect(store.items.map((t) => t.id)).toEqual(['a']);
		stop();
	});

	it('shows last_used live, ignores an older event', async () => {
		const { store, stop } = await started();
		mock.emit('api_tokens', 'update', tok('a', '2026-01-01 00:00:00.000Z', { last_used: '2026-10-28 10:00:00.000Z', updated: '2026-10-28 10:00:00.000Z' }));
		expect(store.items.find((t) => t.id === 'a')?.last_used).toBe('2026-10-28 10:00:00.000Z');
		mock.emit('api_tokens', 'update', tok('a', '2026-01-01 00:00:00.000Z', { last_used: '', updated: '2026-05-01 00:00:00.000Z' }));
		expect(store.items.find((t) => t.id === 'a')?.last_used).toBe('2026-10-28 10:00:00.000Z');
		mock.emit('api_tokens', 'delete', tok('b', '2026-02-01 00:00:00.000Z'));
		expect(store.items.map((t) => t.id)).toEqual(['a']);
		stop();
	});

	it('create: posts the name to the route, returns the token once, no duplicate from realtime', async () => {
		const { store, stop } = await started();
		send.mockResolvedValue({ id: 'n', name: 'Laptop', created: '2026-10-28 12:00:00.000Z', token: 'crm_secret' });
		const res = await store.create('Laptop');
		expect(send).toHaveBeenCalledWith('/api/crm/api-tokens', { method: 'POST', body: { name: 'Laptop' } });
		expect(res?.token).toBe('crm_secret');
		expect(store.items.map((t) => t.id)).toEqual(['n', 'b', 'a']);
		expect(JSON.stringify(store.items)).not.toContain('crm_secret');
		mock.emit('api_tokens', 'create', tok('n', '2026-10-28 12:00:00.000Z', { name: 'Laptop' }));
		expect(store.items.map((t) => t.id)).toEqual(['n', 'b', 'a']);
		stop();
	});

	it('create: a server error ends up in `error`', async () => {
		const { store, stop } = await started();
		send.mockRejectedValue(apiError(400, 'Failed', { name: { code: 'too_many_tokens', message: 'Höchstens 20 Tokens' } }));
		expect(await store.create('x')).toBeNull();
		expect(store.error).toContain('Höchstens 20 Tokens');
		expect(store.items).toHaveLength(2);
		stop();
	});

	it('revoke deletes the record; already gone counts as done', async () => {
		const { store, stop } = await started();
		expect(await store.revoke('a')).toBe(true);
		expect(mock.db.api_tokens.map((t) => t.id)).toEqual(['b']);
		expect(store.items.map((t) => t.id)).toEqual(['b']);
		mock.fail('delete', apiError(404, 'gone'), 'api_tokens');
		expect(await store.revoke('b')).toBe(true);
		expect(store.items).toHaveLength(0);
		expect(store.error).toBe('');
		stop();
	});

	it('revoke: other errors keep the token and show the message', async () => {
		const { store, stop } = await started();
		mock.fail('delete', apiError(500, 'Server kaputt'), 'api_tokens');
		expect(await store.revoke('a')).toBe(false);
		expect(store.items.map((t) => t.id)).toEqual(['b', 'a']);
		expect(store.error).toContain('Server kaputt');
		stop();
	});
});
