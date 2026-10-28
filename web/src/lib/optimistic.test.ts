import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, type PbMock } from './test/pb-mock';

vi.mock('./pb', async (orig) => {
	const { createPbMock } = await import('./test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('./pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from './pb';
import { BATCH_MAX, RankSaveError, RealtimeMarks, rollback, saveRanks } from './optimistic';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

beforeEach(() => mock.reset());

describe('saveRanks', () => {
	it('saves all ranks in one batch request', async () => {
		mock.set('leads', [
			{ id: 'a', rank: 'x' },
			{ id: 'b', rank: 'x' }
		]);
		expect(await saveRanks('leads', [{ id: 'a', rank: 'a0' }, { id: 'b', rank: 'a1' }])).toBe(2);
		expect(mock.calls.filter((c) => c.method === 'batch')).toHaveLength(1);
		expect(mock.calls.some((c) => c.method === 'update')).toBe(false);
		expect(mock.db.leads!.map((l) => l.rank)).toEqual(['a0', 'a1']);
	});

	it('all or nothing: one missing record fails the batch and nothing is saved', async () => {
		mock.set('leads', [{ id: 'a', rank: 'x' }]);
		const err = await saveRanks('leads', [{ id: 'a', rank: 'a0' }, { id: 'gone', rank: 'a1' }]).catch((e) => e);
		expect(err).toBeInstanceOf(RankSaveError);
		expect((err as RankSaveError).saved).toBe(0);
		expect(mock.db.leads![0].rank).toBe('x');
	});

	it('splits lists longer than BATCH_MAX and reports how many were saved before a failure', async () => {
		const n = BATCH_MAX + 5;
		const recs = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, rank: 'x' }));
		mock.set('leads', recs);
		const entries = recs.map((r, i) => ({ id: r.id, rank: `k${i}` }));
		expect(await saveRanks('leads', entries)).toBe(n);
		expect(mock.calls.filter((c) => c.method === 'batch')).toHaveLength(2);

		mock.reset();
		mock.set('leads', recs);
		// first chunk goes through, the second fails
		const first = mock.hold('batch', 'batch');
		const second = mock.hold('batch', 'batch');
		const pending = saveRanks('leads', entries).catch((e) => e);
		first();
		await flush();
		mock.fail('batch', apiError(500, 'boom'));
		second();
		const err = await pending;
		expect(err).toBeInstanceOf(RankSaveError);
		expect((err as RankSaveError).saved).toBe(BATCH_MAX);
		expect(mock.db.leads![0].rank).toBe('k0');
		expect(mock.db.leads![n - 1].rank).toBe('x');
	});
});

describe('rollback', () => {
	it('resets only fields that still hold our value', () => {
		const t = { a: 'ours', b: 'theirs' };
		rollback(t, { a: 'old', b: 'old' }, { a: 'ours', b: 'ours' });
		expect(t).toEqual({ a: 'old', b: 'theirs' });
	});

	it('rolls back nothing when a realtime event arrived while the request was in flight', () => {
		// B saved the same value as ours: indistinguishable without the event mark
		const t = { a: 'ours' };
		rollback(t, { a: 'old' }, { a: 'ours' }, true);
		expect(t).toEqual({ a: 'ours' });
	});
});

describe('RealtimeMarks', () => {
	it('tells whether an event for the record arrived since the mark', () => {
		const m = new RealtimeMarks();
		const mark = m.mark('x');
		expect(m.since('x', mark)).toBe(false);
		m.note('y');
		expect(m.since('x', mark)).toBe(false);
		m.note('x');
		expect(m.since('x', mark)).toBe(true);
	});
});
