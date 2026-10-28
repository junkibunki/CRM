import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pbStub } = vi.hoisted(() => {
	let n = 0;
	const pbStub = {
		authStore: { token: 'auth-1' },
		files: {
			getToken: vi.fn(async () => `ft${++n}`),
			getURL: (rec: { id: string }, name: string, q: Record<string, unknown> = {}) =>
				`/api/files/activities/${rec.id}/${name}?${new URLSearchParams(
					Object.entries(q).map(([k, v]) => [k, String(v)])
				)}`
		}
	};
	return { pbStub };
});
vi.mock('../pb', () => ({ pb: pbStub }));

import { downloadAttachment, fileSize, fileToken, resetFileToken, thumbUrl, TOKEN_TTL } from './files';

const rec = { id: 'r1', collectionId: 'act', collectionName: 'activities' };

beforeEach(() => {
	resetFileToken();
	pbStub.authStore.token = 'auth-1';
	pbStub.files.getToken.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('fileToken', () => {
	it('shares one request between simultaneous callers', async () => {
		const [a, b, c] = await Promise.all([fileToken(), fileToken(), fileToken()]);
		expect(a).toBe(b);
		expect(b).toBe(c);
		expect(pbStub.files.getToken).toHaveBeenCalledTimes(1);
	});

	it('reuses a token only for a short time', async () => {
		vi.useFakeTimers();
		const first = await fileToken();
		vi.advanceTimersByTime(TOKEN_TTL - 1000);
		expect(await fileToken()).toBe(first);
		vi.advanceTimersByTime(2000);
		expect(await fileToken()).not.toBe(first);
		expect(pbStub.files.getToken).toHaveBeenCalledTimes(2);
	});

	it('asks again after a login as someone else, or when forced', async () => {
		const first = await fileToken();
		pbStub.authStore.token = 'auth-2';
		const second = await fileToken();
		expect(second).not.toBe(first);
		expect(await fileToken(true)).not.toBe(second);
	});
});

describe('URLs', () => {
	it('builds preview URLs with token and thumb size', async () => {
		const url = await thumbUrl(rec, 'bild_abcdefghij.png');
		expect(url).toMatch(/^\/api\/files\/activities\/r1\/bild_abcdefghij\.png\?/);
		expect(url).toContain('token=ft');
		expect(url).toContain('thumb=200x200f');
	});

	it('reads the size from a HEAD request', async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200, headers: { 'content-length': '2048' } }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await fileSize(rec, 'a.pdf')).toBe(2048);
		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('token=ft'), { method: 'HEAD' });
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
		expect(await fileSize(rec, 'a.pdf')).toBeNull();
		vi.unstubAllGlobals();
	});

	it('downloads with a freshly created token, never the shared one', async () => {
		const shared = await fileToken();
		const clicked: string[] = [];
		const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
			clicked.push(this.href);
		});
		await downloadAttachment(rec, 'a.pdf');
		expect(pbStub.files.getToken).toHaveBeenCalledTimes(2);
		expect(clicked).toHaveLength(1);
		expect(clicked[0]).toContain('download=true');
		expect(clicked[0]).not.toContain(`token=${shared}&`);
		expect(document.querySelectorAll('a').length).toBe(0); // cleaned up
		spy.mockRestore();
	});
});
