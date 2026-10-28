// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { contactName, fromDateInput, toDateInput } from './types';

describe('date helpers', () => {
	it('converts a PocketBase date to an <input type="date"> value', () => {
		expect(toDateInput('2026-12-24 00:00:00.000Z')).toBe('2026-12-24');
		expect(toDateInput('')).toBe('');
	});

	it('converts an <input type="date"> value back', () => {
		expect(fromDateInput('2026-12-24')).toBe('2026-12-24 00:00:00.000Z');
		expect(fromDateInput('')).toBe('');
	});

	it('round-trips', () => {
		expect(toDateInput(fromDateInput('2026-02-28'))).toBe('2026-02-28');
	});
});

describe('contactName', () => {
	it('joins first and last name, skipping empty parts', () => {
		expect(contactName({ first_name: 'Anna', last_name: 'Müller' })).toBe('Anna Müller');
		expect(contactName({ first_name: '', last_name: 'Müller' })).toBe('Müller');
	});
});
