import { describe, expect, it } from 'vitest';
import { apiError } from '../test/pb-mock';
import { entryErrors, gateError, openOf } from './evaluate';

describe('gateError', () => {
	it('returns the server sentence of a refused move', () => {
		const err = apiError(400, 'Bevor …', {
			column: { code: 'gate_open', message: 'Bevor der Lead nach „Angebot“ kann, …' }
		});
		expect(gateError(err)).toBe('Bevor der Lead nach „Angebot“ kann, …');
	});

	it('is null for other errors', () => {
		expect(gateError(apiError(400, 'x', { column: { code: 'validation_required', message: 'x' } }))).toBeNull();
		expect(gateError(apiError(404, 'x'))).toBeNull();
		expect(gateError(new Error('x'))).toBeNull();
	});
});

describe('openOf', () => {
	const list = [
		{ id: 'a', column: 'c', rank: 'a0', type: 'flag' as const },
		{ id: 'b', column: 'c', rank: 'a1', type: 'text' as const }
	];
	it('drops fulfilled requirements; no checks = all open', () => {
		expect(openOf(list, undefined).map((r) => r.id)).toEqual(['a', 'b']);
		expect(openOf(list, { a: { requirement: 'a', value: 'true' } }).map((r) => r.id)).toEqual(['b']);
		expect(openOf(list, { b: { requirement: 'b', value: ' ' } }).map((r) => r.id)).toEqual(['a', 'b']);
	});
});

describe('entryErrors', () => {
	const reqs = [
		{ id: 'a', label: 'Flag', type: 'flag' as const },
		{ id: 'b', label: 'Nummer', type: 'text' as const }
	];
	it('lists what is still missing in the dialog', () => {
		expect(entryErrors(reqs, [])).toHaveLength(2);
		expect(entryErrors(reqs, [{ requirement: 'a', value: 'true' }, { requirement: 'b', value: '  ' }])).toEqual([
			'Nummer: Bitte einen Wert eintragen.'
		]);
		expect(entryErrors(reqs, [{ requirement: 'a', value: 'true' }, { requirement: 'b', value: 'S-1' }])).toEqual([]);
	});
});
