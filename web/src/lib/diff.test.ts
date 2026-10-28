// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { changedFields } from './diff';

describe('changedFields', () => {
	it('returns only fields that differ', () => {
		expect(changedFields({ a: 1, b: 'x', c: true }, { a: 1, b: 'y', c: true })).toEqual({ b: 'y' });
	});

	it('returns an empty object when nothing changed', () => {
		expect(changedFields({ a: 1, b: '' }, { a: 1, b: '' })).toEqual({});
	});

	it('compares arrays by content and order, not identity', () => {
		expect(changedFields({ ids: ['1', '2'] }, { ids: ['1', '2'] })).toEqual({});
		expect(changedFields({ ids: ['1', '2'] }, { ids: ['2', '1'] })).toEqual({ ids: ['2', '1'] });
		expect(changedFields({ ids: ['1'] }, { ids: ['1', '2'] })).toEqual({ ids: ['1', '2'] });
	});

	it('detects clearing a value', () => {
		expect(changedFields({ due: '2026-01-01' }, { due: '' })).toEqual({ due: '' });
	});
});
