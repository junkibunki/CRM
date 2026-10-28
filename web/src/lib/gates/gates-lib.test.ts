// @vitest-environment node
// Unit tests for the F12 hook library (pocketbase/pb_hooks/stage-gates-lib.js), plain CommonJS
// for the PocketBase JS VM, loaded with Node's require. Also checks that the client's
// evaluation (evaluate.ts) agrees with the server's on the same cases.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as client from './evaluate';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib: any = require('../../../../pocketbase/pb_hooks/stage-gates-lib.js');

// pipeline b1: Neu (a0) < Qualifiziert (a1) < Angebot (a2) < Verhandlung (a3); b2: other pipeline
const columns = [
	{ id: 'verh', board: 'b1', rank: 'a3', name: 'Verhandlung' },
	{ id: 'neu', board: 'b1', rank: 'a0', name: 'Neu' },
	{ id: 'ang', board: 'b1', rank: 'a2', name: 'Angebot' },
	{ id: 'qual', board: 'b1', rank: 'a1', name: 'Qualifiziert' },
	{ id: 'other', board: 'b2', rank: 'a0', name: 'Fremd' }
];
const req = (id: string, column: string, rank: string, type: 'flag' | 'text' = 'flag') => ({
	id,
	column,
	rank,
	type,
	label: `L-${id}`
});
const requirements = [
	req('r-verh', 'verh', 'a0', 'text'),
	req('r-ang2', 'ang', 'a1'),
	req('r-ang1', 'ang', 'a0'),
	req('r-qual', 'qual', 'a0', 'text'),
	req('r-other', 'other', 'a0'),
	req('r-gone', 'deleted-stage', 'a0')
];
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe('applicable: cumulative by stage rank', () => {
	it.each([
		['neu', []],
		['qual', ['r-qual']],
		['ang', ['r-qual', 'r-ang1', 'r-ang2']],
		['verh', ['r-qual', 'r-ang1', 'r-ang2', 'r-verh']],
		['other', ['r-other']],
		['unknown', []]
	])('%s -> %j (stage order, then requirement rank; other pipelines and deleted stages ignored)', (col, want) => {
		expect(ids(lib.applicable(requirements, columns, col))).toEqual(want);
		expect(ids(client.applicable(requirements, columns, col))).toEqual(want);
	});

	it('follows a reordered pipeline (rank, not insertion order)', () => {
		const moved = columns.map((c) => (c.id === 'qual' ? { ...c, rank: 'a2V' } : c)); // behind Angebot
		expect(ids(lib.applicable(requirements, moved, 'ang'))).toEqual(['r-ang1', 'r-ang2']);
		expect(ids(lib.applicable(requirements, moved, 'qual'))).toEqual(['r-ang1', 'r-ang2', 'r-qual']);
		expect(ids(client.applicable(requirements, moved, 'qual'))).toEqual(['r-ang1', 'r-ang2', 'r-qual']);
	});

	it('compares ranks by code point like SQLite (uppercase before lowercase), id as tiebreak', () => {
		const cols = [
			{ id: 'x', board: 'b', rank: 'a0' },
			{ id: 'y', board: 'b', rank: 'Zz' }, // before a0
			{ id: 'w', board: 'b', rank: 'a0' } // same rank as x: id decides (w < x)
		];
		const reqs = [req('rx', 'x', 'a0'), req('ry', 'y', 'a0'), req('rw', 'w', 'a0')];
		expect(ids(lib.applicable(reqs, cols, 'w'))).toEqual(['ry', 'rw']);
		expect(ids(client.applicable(reqs, cols, 'w'))).toEqual(['ry', 'rw']);
		expect(ids(lib.applicable(reqs, cols, 'x'))).toEqual(['ry', 'rw', 'rx']);
	});
});

describe('exempt stages (gates_exempt, e.g. "Verloren")', () => {
	// Neu < Angebot < Gewonnen < Verloren (exempt) < Archiv; "Alt" is exempt but has a requirement
	const cols = [
		{ id: 'neu', board: 'b', rank: 'a0' },
		{ id: 'ang', board: 'b', rank: 'a1' },
		{ id: 'alt', board: 'b', rank: 'a15', gates_exempt: true },
		{ id: 'gew', board: 'b', rank: 'a2' },
		{ id: 'verl', board: 'b', rank: 'a3', gates_exempt: true },
		{ id: 'arch', board: 'b', rank: 'a4' }
	];
	const reqs = [req('r-ang', 'ang', 'a0'), req('r-alt', 'alt', 'a0'), req('r-gew', 'gew', 'a0', 'text')];
	const both = (col: string) => {
		const a = ids(lib.applicable(reqs, cols, col));
		expect(ids(client.applicable(reqs, cols, col))).toEqual(a);
		return a;
	};

	it.each([
		['verl', []], // exempt: neither own nor earlier requirements
		['alt', []],
		// "Gewonnen" needs all, also those of the exempt stage before it: exempting "Alt"
		// afterwards must not let a lead skip its requirement on the way to "Gewonnen"
		['gew', ['r-ang', 'r-alt', 'r-gew']],
		['arch', ['r-ang', 'r-alt', 'r-gew']], // later than an exempt stage: the cumulation goes on
		['ang', ['r-ang']]
	])('%s -> %j', (col, want) => {
		expect(both(col)).toEqual(want);
	});

	it('nothing is open in an exempt stage, whatever the checks', () => {
		expect(lib.openRequirements(reqs, cols, 'verl', [])).toEqual([]);
		expect(client.openRequirements(reqs, cols, 'verl', [])).toEqual([]);
	});

	it('pipelineRequirements: every requirement that can apply, also seen from an exempt stage', () => {
		for (const col of ['neu', 'verl', 'arch']) {
			expect(ids(lib.pipelineRequirements(reqs, cols, col))).toEqual(['r-ang', 'r-alt', 'r-gew']);
			expect(ids(client.pipelineRequirements(reqs, cols, col))).toEqual(['r-ang', 'r-alt', 'r-gew']);
		}
	});
});

describe('writableFields (POST /api/crm/leads takes every lead field)', () => {
	const field = (name: string, type: string, system = false) => ({
		getName: () => name,
		type: () => type,
		getSystem: () => system
	});

	it('all fields except system fields and autodates, including ones added later', () => {
		const collection = {
			fields: [
				field('id', 'text', true),
				field('column', 'relation'),
				field('title', 'text'),
				field('rank', 'text'),
				field('hubspot_id', 'text'), // e.g. added by a later migration
				field('created', 'autodate'),
				field('updated', 'autodate')
			]
		};
		expect(lib.writableFields(collection)).toEqual(['column', 'title', 'rank', 'hubspot_id']);
	});
});

describe('fulfilled / openRequirements', () => {
	it.each([
		['flag', 'true', true],
		['flag', 'false', false],
		['flag', '', false],
		['flag', 'TRUE', false],
		['text', 'S-4711', true],
		['text', '  x ', true],
		['text', '', false],
		['text', '   ', false],
		['text', null, false]
	])('%s with value %j -> %s', (type, value, want) => {
		const r = { type };
		expect(lib.fulfilled(r, { value })).toBe(want);
		expect(client.fulfilled(r as never, { requirement: 'r', value: value as string })).toBe(want);
	});

	it('no check = open', () => {
		expect(lib.fulfilled({ type: 'flag' }, undefined)).toBe(false);
		expect(client.fulfilled({ type: 'text' }, undefined)).toBe(false);
	});

	it('skipping stages: every requirement in between must be fulfilled', () => {
		const checks = [
			{ requirement: 'r-qual', value: 'NDA-1' },
			{ requirement: 'r-ang1', value: 'true' },
			{ requirement: 'r-verh', value: '   ' } // blank text: open
		];
		const want = ['r-ang2', 'r-verh'];
		expect(ids(lib.openRequirements(requirements, columns, 'verh', checks))).toEqual(want);
		expect(ids(client.openRequirements(requirements, columns, 'verh', checks))).toEqual(want);
		expect(ids(lib.openRequirements(requirements, columns, 'qual', checks))).toEqual([]);
	});

	it('checks of other requirements do not count', () => {
		const checks = [{ requirement: 'r-other', value: 'true' }];
		expect(ids(lib.openRequirements(requirements, columns, 'ang', checks))).toEqual(['r-qual', 'r-ang1', 'r-ang2']);
	});
});

describe('normalizeValue', () => {
	it.each([
		['flag', true, { value: 'true' }],
		['flag', 'true', { value: 'true' }],
		['text', '  S-1 ', { value: 'S-1' }]
	])('%s %j -> %j', (type, value, want) => {
		expect(lib.normalizeValue({ type }, value)).toEqual(want);
		expect(client.normalizeValue({ type } as never, value as string)).toEqual(want);
	});

	it.each([
		['flag', 'false'],
		['flag', ''],
		['text', ''],
		['text', '  '],
		['text', 'x'.repeat(1001)]
	])('%s %j is refused', (type, value) => {
		expect(lib.normalizeValue({ type }, value).error).toBeTruthy();
		expect('error' in client.normalizeValue({ type } as never, value)).toBe(true);
	});
});

describe('gateMessage', () => {
	it('names the stage and every open requirement', () => {
		expect(lib.gateMessage('Angebot', [{ label: 'Siemens-Flag' }])).toBe(
			'Bevor der Lead nach „Angebot“ kann, muss diese Bedingung erfüllt sein: „Siemens-Flag“.'
		);
		expect(lib.gateMessage('Verhandlung', [{ label: 'A' }, { label: 'B' }])).toBe(
			'Bevor der Lead nach „Verhandlung“ kann, müssen diese Bedingungen erfüllt sein: „A“, „B“.'
		);
	});

	it('uses the code the client looks for', () => {
		expect(lib.GATE_CODE).toBe(client.GATE_CODE);
	});
});

describe('actorId', () => {
	it('only users count as `by` (a superuser is no users record)', () => {
		expect(lib.actorId({ id: 'u1', collection: () => ({ name: 'users' }) })).toBe('u1');
		expect(lib.actorId({ id: 's1', collection: () => ({ name: '_superusers' }) })).toBe('');
		expect(lib.actorId(null)).toBe('');
	});
});
