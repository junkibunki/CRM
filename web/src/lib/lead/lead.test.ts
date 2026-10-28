import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { LeadStore } from './lead.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const lead = (id: string, column: string, rank: string, extra = {}) => ({
	id,
	column,
	rank,
	title: `Lead ${id}`,
	company: 'co',
	contacts: ['ct'],
	expected_close: '',
	owner: 'u1',
	created: stamp(),
	updated: stamp(),
	...extra
});

const column = (id: string, board: string, rank: string, name = id) => ({
	id,
	board,
	name,
	rank,
	color: 'blue',
	wip_limit: 0,
	updated: stamp()
});

let store: LeadStore;
let stop: () => void;

const leadUpdates = () => mock.calls.filter((c) => c.method === 'update' && c.collection === 'leads');

beforeEach(async () => {
	mock.reset();
	mock.set('board_columns', [
		column('c2', 'b1', 'a1', 'Angebot'),
		column('c1', 'b1', 'a0', 'Neu'),
		column('x1', 'other', 'a0', 'Fremd')
	]);
	mock.set('leads', [
		lead('l1', 'c1', 'a0'),
		lead('l2', 'c1', 'a1'),
		lead('l3', 'c2', 'a0'),
		lead('l4', 'c2', 'a5'),
		lead('l5', 'c2', 'a2')
	]);
	store = new LeadStore('l1');
	stop = store.sync();
	await flush();
	mock.calls.length = 0;
});

afterEach(() => stop?.());

describe('LeadStore: loading', () => {
	it('loads the lead and the stages of its pipeline in board order', () => {
		expect(store.loading).toBe(false);
		expect(store.lead?.title).toBe('Lead l1');
		expect(store.stage?.name).toBe('Neu');
		expect(store.stages.map((c) => c.id)).toEqual(['c1', 'c2']);
	});

	it('shows "gone" for a lead that does not exist (404, session valid)', async () => {
		stop();
		const s = new LeadStore('nope');
		stop = s.sync();
		await flush();
		expect(s.deleted).toBe(true);
		expect(s.removed).toBe(false);
		expect(s.lead).toBeNull();
	});

	it('logs out instead of showing "gone" when the 404 comes from an invalid session', async () => {
		stop();
		mock.invalidateSession();
		const s = new LeadStore('nope');
		stop = s.sync();
		await flush();
		expect(s.deleted).toBe(false);
		expect(mock.pb.authStore.token).toBe('');
	});

	it('reports other load errors and recovers after a reconnect', async () => {
		stop();
		mock.fail('getOne', apiError(500, 'down'), 'leads');
		const s = new LeadStore('l1');
		stop = s.sync();
		await flush();
		expect(s.error).not.toBe('');
		expect(s.lead).toBeNull();
		mock.reconnect();
		await flush();
		expect(s.error).toBe('');
		expect(s.lead?.id).toBe('l1');
	});

	it('teardown ends the subscriptions', () => {
		expect(mock.subscriberCount('leads')).toBe(1);
		expect(mock.subscriberCount('board_columns')).toBe(1);
		stop();
		return flush().then(() => {
			expect(mock.subscriberCount('leads')).toBe(0);
			expect(mock.subscriberCount('board_columns')).toBe(0);
		});
	});
});

describe('LeadStore: realtime', () => {
	it('merges updates into the same object (dialogs holding it stay live)', () => {
		const obj = store.lead;
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { title: 'Neuer Titel', contacts: ['a', 'b'] }));
		expect(store.lead).toBe(obj);
		expect(store.lead?.title).toBe('Neuer Titel');
		expect(store.lead?.contacts).toEqual(['a', 'b']);
	});

	it('follows a stage change made elsewhere', () => {
		mock.emit('leads', 'update', lead('l1', 'c2', 'a9'));
		expect(store.stage?.name).toBe('Angebot');
	});

	it('ignores events of other leads', () => {
		mock.emit('leads', 'update', lead('l2', 'c2', 'a0', { title: 'Fremd' }));
		mock.emit('leads', 'delete', lead('l2', 'c1', 'a1'));
		expect(store.lead?.title).toBe('Lead l1');
		expect(store.deleted).toBe(false);
	});

	it('marks the lead as deleted when someone else deletes it while the page is open', () => {
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		expect(store.deleted).toBe(true);
		expect(store.removed).toBe(false);
	});

	it('buffers an event that arrives while loading and applies it after the load', async () => {
		stop();
		const release = mock.hold('leads', 'getOne');
		const s = new LeadStore('l1');
		stop = s.sync();
		await flush();
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { title: 'Während des Ladens' }));
		release();
		await flush();
		expect(s.lead?.title).toBe('Während des Ladens');
	});

	it('reloads after a reconnect and keeps the lead object', async () => {
		const obj = store.lead;
		mock.db.leads.find((l) => l.id === 'l1')!.title = 'Verpasst';
		mock.reconnect();
		await flush();
		expect(store.lead).toBe(obj);
		expect(store.lead?.title).toBe('Verpasst');
	});

	it('keeps the stage list live: rename, new, reorder, delete', () => {
		mock.emit('board_columns', 'update', column('c1', 'b1', 'a0', 'Erstkontakt'));
		expect(store.stage?.name).toBe('Erstkontakt');
		mock.emit('board_columns', 'create', column('c3', 'b1', 'a2', 'Gewonnen'));
		expect(store.stages.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
		mock.emit('board_columns', 'update', column('c3', 'b1', 'a0V', 'Gewonnen'));
		expect(store.stages.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
		mock.emit('board_columns', 'delete', column('c2', 'b1', 'a1'));
		expect(store.stages.map((c) => c.id)).toEqual(['c1', 'c3']);
	});
});

describe('LeadStore: stage change', () => {
	it('moves the lead to the end of the target stage with one update of column + rank', async () => {
		await store.moveToStage('c2');
		expect(leadUpdates()).toHaveLength(1);
		const [id, data] = leadUpdates()[0].args as [string, { column: string; rank: string }];
		expect(id).toBe('l1');
		expect(data.column).toBe('c2');
		expect(data.rank > 'a5').toBe(true); // after the last lead of c2 (l4, a5)
		expect(store.lead?.column).toBe('c2');
		expect(store.lead?.rank).toBe(data.rank);
		expect(store.stage?.name).toBe('Angebot');
	});

	it('asks the server only for the target stage, without the lead itself', async () => {
		// the mock ignores filters and records no getFullList options: capture them here
		const options: unknown[] = [];
		const orig = mock.pb.collection;
		vi.spyOn(mock.pb, 'collection').mockImplementation((name: string) => {
			const c = orig(name);
			if (name !== 'leads') return c;
			return {
				...c,
				getFullList: (opts?: unknown) => {
					options.push(opts);
					return c.getFullList();
				}
			};
		});
		await store.moveToStage('c2');
		expect(options).toEqual([
			expect.objectContaining({ filter: 'column = "c2" && id != "l1"', sort: 'rank,id' })
		]);
	});

	it('gets a valid rank in an empty stage', async () => {
		mock.set('board_columns', [...mock.db.board_columns, column('c3', 'b1', 'a2')]);
		mock.emit('board_columns', 'create', column('c3', 'b1', 'a2'));
		await store.moveToStage('c3');
		const [, data] = leadUpdates()[0].args as [string, { column: string; rank: string }];
		expect(data).toEqual({ column: 'c3', rank: 'a0' });
	});

	it('does nothing for the current stage or an empty pick (bits-ui deselect)', async () => {
		await store.moveToStage('c1');
		await store.moveToStage('');
		expect(leadUpdates()).toHaveLength(0);
		expect(store.lead?.column).toBe('c1');
	});

	it('refuses a stage that no longer exists', async () => {
		await store.moveToStage('gone');
		expect(leadUpdates()).toHaveLength(0);
		expect(store.error).toContain('Phase');
	});

	it('rolls back when saving fails', async () => {
		mock.fail('update', apiError(500, 'boom'), 'leads');
		await store.moveToStage('c2');
		expect(store.lead?.column).toBe('c1');
		expect(store.lead?.rank).toBe('a0');
		expect(store.error).not.toBe('');
	});

	it('does not roll back over a newer move that arrived by realtime', async () => {
		const release = mock.hold('leads', 'update');
		mock.fail('update', apiError(500, 'boom'), 'leads');
		const done = store.moveToStage('c2');
		await flush();
		mock.emit('leads', 'update', lead('l1', 'c1', 'a3')); // someone else moved it back
		release();
		await done;
		expect(store.lead?.column).toBe('c1');
		expect(store.lead?.rank).toBe('a3');
	});

	it('shows "gone" when the lead was deleted meanwhile (404, session valid)', async () => {
		mock.fail('update', apiError(404, 'gone'), 'leads');
		await store.moveToStage('c2');
		expect(store.deleted).toBe(true);
	});

	it('gives the target stage fresh ranks when its last key is unusable', async () => {
		mock.set('leads', [lead('l1', 'c1', 'a0'), lead('y1', 'c2', 'a0'), lead('y2', 'c2', 'b')]);
		await store.moveToStage('c2');
		const ranks = new Map(leadUpdates().map((u) => [u.args[0], (u.args[1] as { rank: string }).rank]));
		expect([...ranks.keys()].sort()).toEqual(['l1', 'y1', 'y2']);
		const order = ['y1', 'y2', 'l1'].map((id) => ranks.get(id)!);
		expect([...order].sort()).toEqual(order); // the lead ends up last
		expect(new Set(order).size).toBe(3);
	});
});

describe('LeadStore: edit and delete (calls made by LeadDialog)', () => {
	it('updates optimistically and sends only the given fields', async () => {
		await store.updateLead('l1', { title: 'Geändert' });
		expect(store.lead?.title).toBe('Geändert');
		expect(leadUpdates()[0].args).toEqual(['l1', { title: 'Geändert' }]);
	});

	it('rolls back a failed edit, but not a field someone else changed meanwhile', async () => {
		const release = mock.hold('leads', 'update');
		mock.fail('update', apiError(400, 'invalid'), 'leads');
		const done = store.updateLead('l1', { title: 'Mein Titel', owner: 'u2' });
		await flush();
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { title: 'Fremder Titel', owner: 'u2' }));
		release();
		await done;
		expect(store.lead?.title).toBe('Fremder Titel');
		expect(store.lead?.owner).toBe('u1'); // ours, rolled back
		expect(store.error).not.toBe('');
	});

	it('saves contacts as a difference, keeping a contact someone else added meanwhile', async () => {
		// the dialog opened with ['ct']; meanwhile B added 'b'; we add 'me'
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['ct', 'b'] }));
		await store.updateLead('l1', { contacts: ['ct', 'me'] }, { contacts: ['ct'] });
		expect(leadUpdates()[0].args).toEqual(['l1', { 'contacts+': ['me'] }]);
		expect(store.lead?.contacts).toEqual(['ct', 'b', 'me']);
	});

	it('sends a removal as contacts- together with other changed fields', async () => {
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['a', 'b'] }));
		await store.updateLead('l1', { title: 'Neu', contacts: ['a'] }, { title: 'l1', contacts: ['a', 'b'] });
		expect(leadUpdates()[0].args).toEqual(['l1', { title: 'Neu', 'contacts-': ['b'] }]);
		expect(store.lead?.contacts).toEqual(['a']);
		expect(store.lead?.title).toBe('Neu');
	});

	it('rolls the merged contacts back when saving fails', async () => {
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['a', 'b'] }));
		mock.fail('update', apiError(400, 'invalid'), 'leads');
		await store.updateLead('l1', { contacts: ['a', 'b', 'me'] }, { contacts: ['a'] });
		expect(store.lead?.contacts).toEqual(['a', 'b']);
		expect(store.error).not.toBe('');
	});

	it('sends nothing when only the order of the contacts changed', async () => {
		mock.emit('leads', 'update', lead('l1', 'c1', 'a0', { contacts: ['a', 'b'] }));
		await store.updateLead('l1', { contacts: ['b', 'a'] }, { contacts: ['a', 'b'] });
		expect(leadUpdates()).toHaveLength(0);
	});

	it('shows "gone" when an edit hits a deleted lead', async () => {
		mock.fail('update', apiError(404, 'gone'), 'leads');
		await store.updateLead('l1', { title: 'x' });
		expect(store.deleted).toBe(true);
		expect(store.error).toContain('gelöscht');
	});

	it('refuses creating leads (only the board does that)', async () => {
		expect(await store.addLead()).toBe(false);
		expect(store.error).not.toBe('');
	});

	it('deleting here sets removed (the page goes back), not deleted', async () => {
		await store.deleteLead('l1');
		expect(store.removed).toBe(true);
		expect(store.deleted).toBe(false);
		expect(mock.db.leads.some((l) => l.id === 'l1')).toBe(false);
	});

	it('reads the own realtime delete event during deleting as removed', async () => {
		const release = mock.hold('leads', 'delete');
		const done = store.deleteLead('l1');
		await flush();
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		expect(store.deleted).toBe(false);
		expect(store.removed).toBe(true);
		release();
		await done;
	});

	it('keeps the page and shows the error when deleting fails', async () => {
		mock.fail('delete', apiError(500, 'boom'), 'leads');
		await store.deleteLead('l1');
		expect(store.removed).toBe(false);
		expect(store.error).not.toBe('');
		// a later delete by someone else is reported as such again
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		expect(store.deleted).toBe(true);
	});

	it('treats a 404 on delete as done (already deleted by someone else)', async () => {
		mock.fail('delete', apiError(404, 'gone'), 'leads');
		await store.deleteLead('l1');
		expect(store.removed).toBe(true);
	});
});

// A 404 on a write is read as "deleted" only after the session check (isGone): with an
// invalid token PocketBase answers 404 too, then the user is logged out instead.
describe('LeadStore: 404 on writes, valid vs. invalid session', () => {
	it('updateLead: 404 with an invalid session logs out, the lead is not "gone"', async () => {
		mock.fail('update', apiError(404, 'guest'), 'leads');
		mock.invalidateSession();
		await store.updateLead('l1', { title: 'x' });
		expect(mock.pb.authStore.token).toBe('');
		expect(store.deleted).toBe(false);
		expect(store.removed).toBe(false);
		expect(store.lead?.title).toBe('Lead l1'); // rolled back
	});

	it('updateLead: 404 with a valid session marks the lead as deleted', async () => {
		mock.fail('update', apiError(404, 'gone'), 'leads');
		await store.updateLead('l1', { title: 'x' });
		expect(mock.pb.authStore.token).toBe('test-token');
		expect(store.deleted).toBe(true);
		expect(store.removed).toBe(false);
	});

	it('moveToStage: 404 with an invalid session logs out, the lead is not "gone"', async () => {
		mock.fail('update', apiError(404, 'guest'), 'leads');
		mock.invalidateSession();
		await store.moveToStage('c2');
		expect(mock.pb.authStore.token).toBe('');
		expect(store.deleted).toBe(false);
		expect(store.removed).toBe(false);
		expect(store.lead?.column).toBe('c1'); // rolled back
	});

	it('moveToStage: 404 with a valid session marks the lead as deleted', async () => {
		mock.fail('update', apiError(404, 'gone'), 'leads');
		await store.moveToStage('c2');
		expect(mock.pb.authStore.token).toBe('test-token');
		expect(store.deleted).toBe(true);
		expect(store.removed).toBe(false);
	});

	it('deleteLead: 404 with an invalid session logs out, the page stays', async () => {
		mock.fail('delete', apiError(404, 'guest'), 'leads');
		mock.invalidateSession();
		await store.deleteLead('l1');
		expect(mock.pb.authStore.token).toBe('');
		expect(store.deleted).toBe(false);
		expect(store.removed).toBe(false);
	});

	it('deleteLead: 404 with a valid session counts as removed (already gone)', async () => {
		mock.fail('delete', apiError(404, 'gone'), 'leads');
		await store.deleteLead('l1');
		expect(mock.pb.authStore.token).toBe('test-token');
		expect(store.removed).toBe(true);
		expect(store.deleted).toBe(false);
	});
});

describe('LeadStore: deleted while offline', () => {
	it('shows "gone" after the reconnect reload when the delete event was missed', async () => {
		// deleted on the server without an event reaching us (the connection was down)
		mock.set('leads', mock.db.leads.filter((l) => l.id !== 'l1'));
		expect(store.deleted).toBe(false);
		mock.reconnect();
		await flush();
		expect(store.deleted).toBe(true);
		expect(store.removed).toBe(false);
		expect(mock.pb.authStore.token).toBe('test-token');
	});
});
