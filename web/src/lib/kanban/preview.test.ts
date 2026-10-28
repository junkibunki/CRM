import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { BoardStore } from '../board.svelte';
import type { BoardColumn, Lead } from '../types';
import {
	formatCreated,
	formatDay,
	localDate,
	locateLead,
	previewData,
	previewStatus,
	type PreviewLookups
} from './preview';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const lookups: PreviewLookups = {
	company: (id) => ({ co1: 'Muster GmbH', co2: 'Beispiel AG' })[id] ?? '',
	contact: (id) =>
		({
			ct1: { first_name: 'Anna', last_name: 'Schmidt', position: 'Einkauf' },
			ct2: { first_name: '', last_name: 'Meyer', position: '' }
		})[id],
	user: (id) => ({ u1: 'Florian' })[id] ?? ''
};

const lead = (id: string, column: string, rank: string, extra: Partial<Lead> = {}) =>
	({
		id,
		column,
		rank,
		title: `Lead ${id}`,
		company: 'co1',
		contacts: ['ct1'],
		expected_close: '',
		owner: 'u1',
		created: '2026-03-04 09:30:00.000Z',
		updated: stamp(),
		...extra
	}) as Lead;

const col = (id: string, name: string, color: BoardColumn['color'], rank: string) =>
	({
		id,
		collectionId: 'board_columns',
		collectionName: 'board_columns',
		board: 'b1',
		name,
		color,
		wip_limit: 0,
		rank,
		updated: stamp()
	}) as BoardColumn;

describe('previewData', () => {
	const columns = [col('c1', 'Neu', 'blue', 'a0'), col('c2', 'Angebot', '', 'a1')];

	it('collects title, stage with colour, company, contacts, owner', () => {
		const board = { columns, leads: { c1: [lead('l1', 'c1', 'a0')], c2: [] } };
		const d = previewData(board, 'l1', lookups, '2026-10-28')!;
		expect(d.lead.title).toBe('Lead l1');
		expect(d.column?.name).toBe('Neu');
		expect(d.dot).toBe('bg-blue-500');
		expect(d.company).toBe('Muster GmbH');
		expect(d.contacts).toEqual([{ id: 'ct1', name: 'Anna Schmidt', position: 'Einkauf' }]);
		expect(d.owner).toBe('Florian');
	});

	it('shows the stage of the list the lead sits in, not its column field', () => {
		// optimistic move: field and list can disagree for a moment; the board shows the list
		const board = { columns, leads: { c1: [], c2: [lead('l1', 'c1', 'a0')] } };
		const d = previewData(board, 'l1', lookups, '2026-10-28')!;
		expect(d.column?.id).toBe('c2');
		expect(d.dot).toBe('bg-neutral-400'); // no colour -> grey, as in the column header
	});

	it('lists several contacts and skips unknown ones', () => {
		const board = {
			columns,
			leads: { c1: [lead('l1', 'c1', 'a0', { contacts: ['ct1', 'gone', 'ct2'] })] }
		};
		const d = previewData(board, 'l1', lookups, '2026-10-28')!;
		expect(d.contacts.map((c) => c.name)).toEqual(['Anna Schmidt', 'Meyer']);
		expect(d.contacts[1].position).toBe('');
	});

	it('marks an expected close before today as overdue, today and later not', () => {
		const at = (expected_close: string) =>
			previewData(
				{ columns, leads: { c1: [lead('l1', 'c1', 'a0', { expected_close })] } },
				'l1',
				lookups,
				'2026-10-28'
			)!;
		expect(at('2026-10-27 00:00:00.000Z')).toMatchObject({ close: '2026-10-27', overdue: true });
		expect(at('2026-10-28 00:00:00.000Z').overdue).toBe(false);
		expect(at('2026-11-01 00:00:00.000Z').overdue).toBe(false);
		expect(at('')).toMatchObject({ close: '', overdue: false });
	});

	it('returns null when the lead is not on the board', () => {
		expect(previewData({ columns, leads: { c1: [] } }, 'l1', lookups, '2026-10-28')).toBeNull();
	});

	it('copes with a lead whose stage is unknown or whose names are not loaded', () => {
		const board = { columns: [], leads: { cX: [lead('l1', 'cX', 'a0', { company: 'nope' })] } };
		const d = previewData(board, 'l1', lookups, '2026-10-28')!;
		expect(d.column).toBeNull();
		expect(d.company).toBe('');
	});
});

describe('helpers', () => {
	it('locateLead finds the list a lead sits in', () => {
		const l = lead('l2', 'c1', 'a1');
		expect(locateLead({ c1: [lead('l1', 'c1', 'a0')], c2: [l] }, 'l2')).toEqual({
			lead: l,
			column: 'c2'
		});
		expect(locateLead({ c1: [] }, 'l2')).toBeNull();
	});

	it('localDate uses local time, not UTC', () => {
		expect(localDate(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
		expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
	});

	it('formats dates in German', () => {
		expect(formatDay('2026-12-31')).toBe('31.12.2026');
		expect(formatDay('')).toBe('');
		expect(formatCreated('2026-03-04 09:30:00.000Z')).toMatch(/04\.03\.2026|4\. März 2026/);
		expect(formatCreated('')).toBe('');
		expect(formatCreated('kaputt')).toBe('');
	});

	it('previewStatus: idle while closed, gone when the lead vanished while open', () => {
		const d = previewData(
			{ columns: [], leads: { c1: [lead('l1', 'c1', 'a0')] } },
			'l1',
			lookups,
			'2026-10-28'
		);
		expect(previewStatus(false, 'l1', null)).toBe('idle');
		expect(previewStatus(true, null, null)).toBe('idle');
		expect(previewStatus(true, 'l1', d)).toBe('show');
		expect(previewStatus(true, 'l1', null)).toBe('gone');
	});
});

describe('quick view on a live board (BoardStore + realtime)', () => {
	let store: BoardStore;
	let stop: () => void;
	const view = () => previewData(store, 'l1', lookups, '2026-10-28');

	beforeEach(async () => {
		mock.reset();
		mock.set('boards', [{ id: 'b1', name: 'Leads', card_fields: ['company'] }]);
		mock.set('board_columns', [col('c1', 'Neu', 'blue', 'a0'), col('c2', 'Angebot', 'green', 'a1')]);
		mock.set('leads', [lead('l1', 'c1', 'a0'), lead('l2', 'c1', 'a1')]);
		store = new BoardStore('b1');
		stop = store.sync();
		await flush();
	});
	afterEach(() => stop?.());

	it("follows someone else's edit and move", () => {
		expect(view()).toMatchObject({ company: 'Muster GmbH', column: { id: 'c1' } });
		mock.emit('leads', 'update', {
			...lead('l1', 'c2', 'a0'),
			title: 'Neuer Titel',
			company: 'co2',
			expected_close: '2026-01-01 00:00:00.000Z'
		});
		expect(view()).toMatchObject({
			lead: { title: 'Neuer Titel' },
			company: 'Beispiel AG',
			column: { id: 'c2', name: 'Angebot' },
			dot: 'bg-emerald-500',
			overdue: true
		});
	});

	it('follows a renamed or recoloured stage', () => {
		mock.emit('board_columns', 'update', col('c1', 'Erstkontakt', 'red', 'a0'));
		expect(view()).toMatchObject({ column: { name: 'Erstkontakt' }, dot: 'bg-red-500' });
	});

	it('is gone after a realtime delete of the lead', () => {
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		expect(view()).toBeNull();
		expect(previewStatus(true, 'l1', view())).toBe('gone');
		expect(previewData(store, 'l2', lookups, '2026-10-28')).not.toBeNull();
	});

	it('is gone after its stage was deleted (cascade)', () => {
		mock.emit('board_columns', 'delete', col('c1', 'Neu', 'blue', 'a0'));
		expect(view()).toBeNull();
	});

	it('survives a reconnect that brings unchanged data', async () => {
		const before = view()!.lead;
		mock.reconnect();
		await flush();
		expect(view()!.lead).toBe(before);
	});

	it('is gone after a reconnect when the lead was deleted while offline', async () => {
		mock.db.leads = mock.db.leads!.filter((l) => l.id !== 'l1');
		mock.reconnect();
		await flush();
		expect(view()).toBeNull();
	});
});
