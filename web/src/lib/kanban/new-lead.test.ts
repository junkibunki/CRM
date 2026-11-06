// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BoardColumn } from '#lib/types.js';
import { DEFAULT_LEAD_TITLE, entryColumn } from './new-lead';

const col = (id: string, closed?: boolean) => ({ id, closed }) as BoardColumn;

it('a new lead starts as "Mendix Landing"', () => {
	expect(DEFAULT_LEAD_TITLE).toBe('Mendix Landing');
});

describe('entryColumn', () => {
	it('takes the first stage of the pipeline', () => {
		expect(entryColumn([col('a'), col('b')])?.id).toBe('a');
	});

	it('skips closed stages (won/lost)', () => {
		expect(entryColumn([col('won', true), col('b'), col('c')])?.id).toBe('b');
	});

	it('is null without an open stage', () => {
		expect(entryColumn([])).toBeNull();
		expect(entryColumn([col('won', true), col('lost', true)])).toBeNull();
	});
});
