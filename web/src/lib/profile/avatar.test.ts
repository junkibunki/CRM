import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { AVATAR_MAX_BYTES, avatarFileError, initials, saveAvatar } from './avatar';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

beforeEach(() => {
	mock.reset();
	mock.set('users', [{ id: 'u1', name: 'Test User', email: 'test@example.com', avatar: '' }]);
});

describe('initials', () => {
	it('takes first and last word of the name', () => {
		expect(initials('Anna Berg')).toBe('AB');
		expect(initials('  anna maria   berg ')).toBe('AB');
		expect(initials('Anna')).toBe('A');
	});

	it('falls back to the e-mail address', () => {
		expect(initials('', 'max.muster@firma.de')).toBe('MM');
		expect(initials(null, 'info@firma.de')).toBe('I');
	});

	it('handles umlauts and nothing at all', () => {
		expect(initials('Özlem Ünal')).toBe('ÖÜ');
		expect(initials('', '')).toBe('?');
		expect(initials(undefined, undefined)).toBe('?');
	});
});

describe('avatarFileError', () => {
	it('accepts jpg, png and webp up to 5 MB', () => {
		expect(avatarFileError({ type: 'image/jpeg', size: 1000 })).toBeNull();
		expect(avatarFileError({ type: 'image/webp', size: AVATAR_MAX_BYTES })).toBeNull();
	});

	it('rejects svg, other files and big images', () => {
		expect(avatarFileError({ type: 'image/svg+xml', size: 10 })).toMatch(/JPG, PNG oder WebP/);
		expect(avatarFileError({ type: 'application/pdf', size: 10 })).toMatch(/JPG/);
		expect(avatarFileError({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 })).toMatch(/zu groß/);
	});
});

describe('saveAvatar', () => {
	const lastUpdate = () => mock.calls.filter((c) => c.method === 'update').at(-1);

	it('removes the picture of the logged-in user', async () => {
		expect(await saveAvatar(null)).toBeNull();
		expect(lastUpdate()).toMatchObject({ collection: 'users', args: ['u1', { avatar: null }] });
	});

	it('uploads a valid picture for the logged-in user', async () => {
		const file = new File(['png'], 'me.png', { type: 'image/png' });
		expect(await saveAvatar(file)).toBeNull();
		const call = lastUpdate();
		expect(call?.args[0]).toBe('u1');
		expect((call?.args[1] as { avatar: File }).avatar).toBe(file);
	});

	it('does not send an invalid file', async () => {
		const file = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
		expect(await saveAvatar(file)).toMatch(/JPG/);
		expect(lastUpdate()).toBeUndefined();
	});

	it('reports a server error and checks the session on 404', async () => {
		mock.fail('update', apiError(404, 'gone'), 'users');
		expect(await saveAvatar(null)).toMatch(/gelöscht/);
		await Promise.resolve();
		expect(mock.calls.some((c) => c.method === 'authRefresh')).toBe(true);
	});

	it('needs a session', async () => {
		mock.pb.authStore.clear();
		expect(await saveAvatar(null)).toMatch(/Nicht angemeldet/);
		expect(lastUpdate()).toBeUndefined();
	});
});
