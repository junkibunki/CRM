import { describe, expect, it } from 'vitest';
import { filterShowing, onRevealActivity, revealActivity } from './reveal';

describe('filterShowing', () => {
	it('keeps a filter that shows the note, else switches to "Alle"', () => {
		expect(filterShowing({ type: 'note' }, 'note')).toBe('note');
		expect(filterShowing({ type: 'note' }, 'all')).toBe('all');
		expect(filterShowing({ type: 'meeting' }, 'note')).toBe('all'); // the link used to do nothing here
		expect(filterShowing({ type: 'note' }, 'email')).toBe('all');
		expect(filterShowing({ type: 'email_in' }, 'email')).toBe('email');
	});
});

describe('revealActivity', () => {
	it('asks the registered timeline; false when none has the activity', () => {
		expect(revealActivity('a1')).toBe(false);
		const asked: string[] = [];
		const stop = onRevealActivity((id) => {
			asked.push(id);
			return id === 'a1';
		});
		expect(revealActivity('a1')).toBe(true);
		expect(revealActivity('zz')).toBe(false);
		expect(asked).toEqual(['a1', 'zz']);
		stop();
		expect(revealActivity('a1')).toBe(false);
	});
});
