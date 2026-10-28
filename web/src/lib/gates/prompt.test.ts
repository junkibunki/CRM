// The board's move through a stage gate (F12), with the real BoardStore and GateStore on the
// PocketBase mock: no optimistic move before the confirmation, "Abbrechen" leaves the card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, flush, stamp, type PbMock } from '../test/pb-mock';

vi.mock('../pb', async (orig) => {
	const { createPbMock } = await import('../test/pb-mock');
	const mock = createPbMock();
	return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
});

import * as pbModule from '../pb';
import { BoardStore } from '../board.svelte';
import { GateStore } from './gates.svelte';
import { GATES_LOADING, GatePrompt, createPlan, gateMove, moveOnBoard } from './prompt.svelte';

const mock = (pbModule as unknown as { __mock: PbMock }).__mock;

const lead = (id: string, column: string, rank: string) => ({
	id,
	column,
	rank,
	title: `Lead ${id}`,
	company: 'co',
	contacts: ['ct'],
	expected_close: '',
	owner: 'u1',
	created: stamp(),
	updated: stamp()
});

let board: BoardStore;
let gates: GateStore;
let prompt: GatePrompt;
let stops: (() => void)[] = [];

const inColumn = (col: string) => (board.leads[col] ?? []).map((l) => l.id);
const leadUpdates = () => mock.calls.filter((c) => c.collection === 'leads' && c.method === 'update');
const order = () => mock.calls.filter((c) => c.method === 'create' || c.method === 'update').map((c) => c.collection);

afterEach(() => stops.forEach((s) => s()));

beforeEach(async () => {
	mock.reset();
	mock.set('boards', [{ id: 'b1', name: 'Leads', card_fields: [] }]);
	mock.set('board_columns', [
		{ id: 'c1', board: 'b1', name: 'Neu', rank: 'a0', updated: stamp() },
		{ id: 'c2', board: 'b1', name: 'Angebot', rank: 'a1', updated: stamp() },
		{ id: 'c3', board: 'b1', name: 'Verhandlung', rank: 'a2', updated: stamp() },
		{ id: 'c4', board: 'b1', name: 'Verloren', rank: 'a3', gates_exempt: true, updated: stamp() }
	]);
	mock.set('leads', [lead('l1', 'c1', 'a0'), lead('l2', 'c1', 'a1')]);
	mock.set('stage_requirements', [
		{ id: 'flag', column: 'c2', label: 'Siemens-Flag', type: 'flag', hint: 'Vertrieb informieren', rank: 'a0', updated: stamp() },
		{ id: 'nr', column: 'c3', label: 'Siemens-Nummer', type: 'text', hint: '', rank: 'a0', updated: stamp() }
	]);
	mock.set('lead_checks', []);
	board = new BoardStore('b1');
	gates = GateStore.forBoard('b1');
	prompt = new GatePrompt();
	stops = [board.sync(), gates.sync()];
	await flush();
	mock.calls.length = 0;
});

describe('moving a card into a stage with open requirements', () => {
	it('asks first: the card stays and nothing is saved', () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		expect(prompt.open).toBe(true);
		expect(prompt.request?.title).toBe('Bevor „Lead l1“ nach „Angebot“ kann');
		expect(prompt.request?.requirements.map((r) => r.id)).toEqual(['flag']);
		expect(prompt.request?.confirmLabel).toBe('Bestätigen und verschieben');
		expect(inColumn('c1')).toEqual(['l1', 'l2']);
		expect(mock.calls).toEqual([]);
	});

	it('"Abbrechen" leaves the card where it is', async () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		prompt.cancel();
		await flush();
		expect(prompt.open).toBe(false);
		expect(inColumn('c1')).toEqual(['l1', 'l2']);
		expect(inColumn('c2')).toEqual([]);
		expect(mock.calls).toEqual([]);
	});

	it('"Bestätigen und verschieben" saves the confirmation first, then moves', async () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		const err = await prompt.confirm([{ requirement: 'flag', value: 'true' }]);
		await flush();
		expect(err).toBeNull();
		expect(prompt.open).toBe(false);
		expect(order()).toEqual(['lead_checks', 'leads']);
		expect(leadUpdates()[0].args[1]).toMatchObject({ column: 'c2' });
		expect(inColumn('c2')).toEqual(['l1']);
		expect(gates.openFor('l1', 'c2', board.columns)).toEqual([]);
	});

	it('skipping stages asks for every requirement in between', () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c3', 0);
		expect(prompt.request?.requirements.map((r) => r.id)).toEqual(['flag', 'nr']);
		expect(prompt.request?.description).toBe('Diese 2 Bedingungen sind noch offen:');
	});

	it('a failed confirmation keeps the dialog open and does not move', async () => {
		mock.fail('create', apiError(500, 'kaputt'), 'lead_checks');
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		const err = await prompt.confirm([{ requirement: 'flag', value: 'true' }]);
		await flush();
		expect(err).toBeTruthy();
		expect(prompt.open).toBe(true);
		expect(leadUpdates()).toEqual([]);
		expect(inColumn('c1')).toEqual(['l1', 'l2']);
	});

	it('a move the server refuses anyway (requirement added meanwhile) rolls back with its sentence', async () => {
		const msg = 'Bevor der Lead nach „Angebot“ kann, muss diese Bedingung erfüllt sein: „Neu“.';
		mock.fail('update', apiError(400, msg, { column: { code: 'gate_open', message: msg } }), 'leads');
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		await prompt.confirm([{ requirement: 'flag', value: 'true' }]);
		await flush();
		expect(inColumn('c1')).toEqual(['l1', 'l2']);
		expect(board.error).toBe(msg);
	});
});

describe('moving without open requirements', () => {
	it('fulfilled requirements: moves right away, no dialog, no extra click', async () => {
		mock.emit('lead_checks', 'create', { id: 'k1', lead: 'l1', requirement: 'flag', value: 'true', by: 'u1', updated: stamp() });
		moveOnBoard(board, gates, prompt, 'l1', 'c2', 0);
		await flush();
		expect(prompt.open).toBe(false);
		expect(inColumn('c2')).toEqual(['l1']);
		expect(order()).toEqual(['leads']);
	});

	it('within the same stage: just reorders (even if its requirements are open)', async () => {
		mock.set('leads', [lead('l3', 'c2', 'a0'), lead('l4', 'c2', 'a1')]);
		mock.reconnect();
		await flush();
		mock.calls.length = 0;
		moveOnBoard(board, gates, prompt, 'l4', 'c2', 0);
		await flush();
		expect(prompt.open).toBe(false);
		expect(inColumn('c2')).toEqual(['l4', 'l3']);
	});

	it('into an exempt stage ("Verloren", after every gate): moves without dialog', async () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c4', 0);
		await flush();
		expect(prompt.open).toBe(false);
		expect(inColumn('c4')).toEqual(['l1']);
		// and no warning for cards there
		expect(gates.openFor('l1', 'c4', board.columns)).toEqual([]);
	});

	it('back into an earlier stage without requirements: moves', async () => {
		moveOnBoard(board, gates, prompt, 'l1', 'c1', 1);
		await flush();
		expect(prompt.open).toBe(false);
	});

	it('while the requirements are still loading: no move, no dialog, a short hint', async () => {
		const loading = GateStore.forBoard('b1'); // never synced: loaded = false
		moveOnBoard(board, loading, prompt, 'l1', 'c2', 0);
		await flush();
		expect(prompt.open).toBe(false);
		expect(inColumn('c1')).toEqual(['l1', 'l2']);
		expect(leadUpdates()).toEqual([]);
		expect(loading.error).toBe(GATES_LOADING);
	});

	it('without a gate store (not wired): moves, the server is the last line', async () => {
		gateMove({ gates: undefined, prompt, lead: { id: 'l1', title: 'x' }, target: { id: 'c2', name: 'Angebot' }, columns: board.columns, move: () => board.moveLead('l1', 'c2', 0) });
		await flush();
		expect(prompt.open).toBe(false);
		expect(leadUpdates()).toHaveLength(1);
	});
});

describe('createPlan (new lead in the LeadDialog)', () => {
	it('waits while the requirements are loading: nothing is created', () => {
		expect(createPlan(GateStore.forBoard('b1'), board.columns, 'c2')).toEqual({ kind: 'wait' });
	});

	it('a stage with (cumulative) requirements: confirm first', () => {
		const plan = createPlan(gates, board.columns, 'c3');
		expect(plan.kind).toBe('gate');
		expect(plan.kind === 'gate' && plan.requirements.map((r) => r.id)).toEqual(['flag', 'nr']);
	});

	it('no requirements, an exempt stage or no gate store: create directly', () => {
		expect(createPlan(gates, board.columns, 'c1')).toEqual({ kind: 'direct' });
		expect(createPlan(gates, board.columns, 'c4')).toEqual({ kind: 'direct' });
		expect(createPlan(undefined, board.columns, 'c2')).toEqual({ kind: 'direct' });
	});
});
