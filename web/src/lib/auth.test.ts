import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { auth } from './auth.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

beforeEach(() => mock.reset());

describe('auth.refresh', () => {
	it('keeps a valid session', async () => {
		expect(await auth.refresh()).toBe(true);
		expect(mock.pb.authStore.token).toBe('test-token');
	});

	it('logs out on 401 (session invalidated, e.g. password changed by the admin)', async () => {
		mock.invalidateSession();
		expect(await auth.refresh()).toBe(false);
		expect(mock.pb.authStore.token).toBe('');
	});

	it('logs out on 404 (user deleted)', async () => {
		mock.fail('authRefresh', apiError(404, 'gone'), 'users');
		expect(await auth.refresh()).toBe(false);
		expect(mock.pb.authStore.token).toBe('');
	});

	it('keeps the session when PocketBase is just unreachable', async () => {
		mock.fail('authRefresh', apiError(0, 'network'), 'users');
		expect(await auth.refresh()).toBe(true);
		expect(mock.pb.authStore.token).toBe('test-token');
	});

	it('logs out without a request when the token is already expired locally', async () => {
		mock.pb.authStore.isValid = false;
		const before = mock.calls.length;
		expect(await auth.refresh()).toBe(false);
		expect(mock.calls.length).toBe(before);
	});

	it('reuses a recent successful check of the same session with maxAge', async () => {
		const count = () => mock.calls.filter((c) => c.method === 'authRefresh').length;
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
		try {
			await auth.refresh();
			const before = count();
			expect(await auth.refresh(5000)).toBe(true);
			expect(count()).toBe(before); // reused
			expect(await auth.refresh()).toBe(true);
			expect(count()).toBe(before + 1); // without maxAge: always asks
			now.mockReturnValue(1_000_000 + 6000);
			await auth.refresh(5000);
			expect(count()).toBe(before + 2); // too old: asks again
		} finally {
			now.mockRestore();
		}
	});

	it('does not reuse a check across logout and login', async () => {
		await auth.refresh();
		auth.logout();
		mock.reset(); // logged in again (same token in the mock)
		mock.invalidateSession();
		expect(await auth.refresh(5000)).toBe(false);
		expect(mock.pb.authStore.token).toBe('');
	});

	it('does not reuse a check of a different token', async () => {
		await auth.refresh();
		mock.pb.authStore.token = 'other-token';
		mock.invalidateSession();
		expect(await auth.refresh(5000)).toBe(false);
	});

	it('shares one request between concurrent callers', async () => {
		const before = mock.calls.filter((c) => c.method === 'authRefresh').length;
		const results = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);
		expect(results).toEqual([true, true, true]);
		expect(mock.calls.filter((c) => c.method === 'authRefresh').length - before).toBe(1);
	});
});
