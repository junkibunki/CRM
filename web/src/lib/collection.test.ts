import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { LiveCollection } from './collection.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

type Item = { id: string; name: string; updated: string; collectionId: string; collectionName: string };
const item = (id: string, name: string): Item => ({
	id,
	name,
	updated: stamp(),
	collectionId: 'c',
	collectionName: 'things'
});

let things: LiveCollection<Item>;

beforeEach(() => {
	mock.reset();
	mock.set('things', [item('2', 'Zeppelin'), item('1', 'Äpfel'), item('3', 'Birne')]);
	things = new LiveCollection<Item>('things', (a, b) => a.name.localeCompare(b.name, 'de'));
});

describe('LiveCollection', () => {
	it('loads on first use and sorts German (Ä with A, not after Z)', async () => {
		const release = things.use();
		await flush();
		expect(things.loaded).toBe(true);
		expect(things.list.map((t) => t.name)).toEqual(['Äpfel', 'Birne', 'Zeppelin']);
		expect(things.get('3')?.name).toBe('Birne');
		release();
	});

	it('is ref-counted: one subscription for several users, gone after the last release', async () => {
		const r1 = things.use();
		const r2 = things.use();
		await flush();
		expect(mock.subscriberCount('things')).toBe(1);
		r1();
		await flush();
		expect(mock.subscriberCount('things')).toBe(1);
		r2();
		await flush();
		expect(mock.subscriberCount('things')).toBe(0);
	});

	it('applies realtime create/update/delete in sorted position', async () => {
		const release = things.use();
		await flush();
		mock.emit('things', 'create', item('4', 'Apfelsine'));
		mock.emit('things', 'update', { ...item('2', 'Aal') });
		mock.emit('things', 'delete', item('3', 'Birne'));
		expect(things.list.map((t) => t.name)).toEqual(['Aal', 'Äpfel', 'Apfelsine']);
		release();
	});

	it('does not duplicate a record created here when its realtime event follows', async () => {
		const release = things.use();
		await flush();
		const rec = await things.create({ name: 'Kiwi' } as Partial<Item>);
		mock.emit('things', 'create', rec as unknown as Item);
		expect(things.list.filter((t) => t.name === 'Kiwi')).toHaveLength(1);
		release();
	});

	it('keeps a newer realtime version over an older update response', async () => {
		const release = things.use();
		await flush();
		const hold = mock.hold('things', 'update');
		const pending = things.update('1', { name: 'Ananas' } as Partial<Item>);
		await flush();
		// someone else saved later; their event arrives before our response
		mock.emit('things', 'update', { ...item('1', 'Apfel (neuer)'), updated: '2999-01-01 00:00:00.000000Z' });
		hold();
		await pending;
		expect(things.get('1')?.name).toBe('Apfel (neuer)');
		release();
	});

	it('does not resurrect a record deleted by someone else while updating', async () => {
		const release = things.use();
		await flush();
		const hold = mock.hold('things', 'update');
		const pending = things.update('1', { name: 'Ananas' } as Partial<Item>);
		await flush();
		mock.emit('things', 'delete', item('1', 'Äpfel'));
		hold();
		await pending;
		expect(things.get('1')).toBeUndefined();
		release();
	});

	it('checks the session after a failed write (guest answers look like 400/404)', async () => {
		const release = things.use();
		await flush();
		mock.fail('update', apiError(404, 'not found'), 'things');
		mock.invalidateSession();
		await expect(things.update('1', { name: 'x' } as Partial<Item>)).rejects.toBeTruthy();
		expect(mock.pb.authStore.token).toBe(''); // logged out
		release();
	});
});
