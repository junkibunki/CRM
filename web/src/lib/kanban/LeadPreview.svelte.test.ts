// Component test of the quick view: the effects around the data (closing when the lead is
// deleted, handing over to the lead dialog), which preview.test.ts can't reach.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { BoardStore } from '../board.svelte';
import type { Lead } from '../types';
import LeadPreview from './LeadPreview.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const lead = (id: string, column: string, rank: string) => ({
	id,
	column,
	rank,
	title: `Lead ${id}`,
	company: '',
	contacts: [],
	expected_close: '',
	owner: '',
	created: '2026-03-04 09:30:00.000Z',
	updated: stamp()
});

let store: BoardStore;
let stopSync: () => void;
let cmp: ReturnType<typeof mount> | null = null;
let open = $state(false);
let leadId = $state<string | null>(null);
const onedit = vi.fn<(lead: Lead) => void>();

function show(id: string) {
	const target = document.createElement('div');
	document.body.append(target);
	leadId = id;
	open = true;
	cmp = mount(LeadPreview, {
		target,
		props: {
			store,
			onedit,
			get leadId() {
				return leadId;
			},
			get open() {
				return open;
			},
			set open(v: boolean) {
				open = v;
			}
		}
	});
	flushSync();
}

const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(async () => {
	mock.reset();
	onedit.mockReset();
	mock.set('boards', [{ id: 'b1', name: 'Leads', card_fields: [] }]);
	mock.set('board_columns', [{ id: 'c1', board: 'b1', name: 'Neu', color: 'blue', rank: 'a0', updated: stamp() }]);
	mock.set('leads', [lead('l1', 'c1', 'a0'), lead('l2', 'c1', 'a1')]);
	store = new BoardStore('b1');
	stopSync = store.sync();
	await flush();
});

afterEach(() => {
	if (cmp) unmount(cmp);
	cmp = null;
	stopSync?.();
	document.body.innerHTML = '';
});

describe('LeadPreview', () => {
	it('shows the lead and a German close button for screen readers', () => {
		show('l1');
		expect(document.body.textContent).toContain('Lead l1');
		const close = [...document.querySelectorAll('[data-slot="dialog-close"]')];
		expect(close).toHaveLength(1);
		expect(close[0].textContent).toContain('Schließen');
		expect(document.body.textContent).not.toContain('Close');
	});

	it('closes with a notice when someone else deletes the lead while it is open', async () => {
		show('l1');
		mock.emit('leads', 'delete', lead('l1', 'c1', 'a0'));
		flushSync();
		expect(open).toBe(false);
		expect(document.querySelector('[role="status"]')?.textContent).toContain(
			'Der Lead „Lead l1“ wurde inzwischen gelöscht.'
		);
	});

	it('stays open when another lead is deleted', () => {
		show('l1');
		mock.emit('leads', 'delete', lead('l2', 'c1', 'a1'));
		flushSync();
		expect(open).toBe(true);
		expect(document.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
	});

	it('"Bearbeiten" closes the quick view and hands the lead (the store\'s object) to the dialog', () => {
		show('l1');
		button('Bearbeiten')!.click();
		flushSync();
		expect(open).toBe(false);
		expect(onedit).toHaveBeenCalledTimes(1);
		expect(onedit.mock.calls[0][0]).toBe(store.leads.c1![0]);
	});
});
