import { describe, expect, it } from 'vitest';
import type { Contact } from '../types';
import { participantOptions, teamFor, withId } from './participants';

const c = (id: string, company = ''): Contact =>
	({ id, company, first_name: '', last_name: id, position: '', email: '', phone: '', notes: '' }) as Contact;

// sorted by name, as contacts.list is
const all = [c('anna', 'acme'), c('bert', 'other'), c('carl', 'acme'), c('dora', ''), c('emil', 'acme')];
const ids = (list: Contact[]) => list.map((x) => x.id);

describe('participantOptions', () => {
	it('offers the lead contacts first, then everyone else at the company', () => {
		const o = participantOptions(all, ['carl'], 'acme', []);
		expect(ids(o.lead)).toEqual(['carl']);
		expect(ids(o.company)).toEqual(['anna', 'emil']);
	});

	it('a lead contact from another company stays in the lead group, not twice', () => {
		const o = participantOptions(all, ['bert', 'anna'], 'acme', ['anna']);
		expect(ids(o.lead)).toEqual(['anna', 'bert']);
		expect(ids(o.company)).toEqual(['carl', 'emil']);
	});

	it('keeps a chosen contact that is neither on the lead nor at the company', () => {
		const o = participantOptions(all, ['anna'], 'acme', ['dora', 'bert']);
		expect(ids(o.lead)).toEqual(['anna', 'bert', 'dora']);
		expect(ids(o.company)).toEqual(['carl', 'emil']);
	});

	it('a chosen company contact is listed in the company group', () => {
		const o = participantOptions(all, [], 'acme', ['emil']);
		expect(ids(o.lead)).toEqual([]);
		expect(ids(o.company)).toEqual(['anna', 'carl', 'emil']);
	});

	it('without a company (lead not loaded yet) only lead and chosen contacts; contacts without company are not "the company"', () => {
		const o = participantOptions(all, ['bert'], '', []);
		expect(ids(o.lead)).toEqual(['bert']);
		expect(ids(o.company)).toEqual([]);
	});
});

describe('teamFor', () => {
	it('keeps internal participants only for meetings', () => {
		const team = ['u1', 'u2'];
		expect(teamFor('meeting', team)).toEqual(['u1', 'u2']);
		expect(teamFor('meeting', team)).not.toBe(team); // a copy, not the $state array
		expect(teamFor('note', team)).toEqual([]);
		expect(teamFor('email_in', team)).toEqual([]);
		expect(teamFor('email_out', team)).toEqual([]);
	});
});

describe('withId', () => {
	it('appends a new id once', () => {
		expect(withId(['a'], 'b')).toEqual(['a', 'b']);
		expect(withId(['a', 'b'], 'a')).toEqual(['a', 'b']);
		expect(withId([], 'a')).toEqual(['a']);
	});
});
