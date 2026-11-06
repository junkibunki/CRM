import type { Contact } from '../types';
import type { ActivityType } from './types';

export type ParticipantOptions = {
	/** the lead's contacts, plus chosen ones from elsewhere (e.g. removed from the lead since) */
	lead: Contact[];
	/** everyone else at the lead's company */
	company: Contact[];
};

/**
 * The contacts an activity can name, in two groups, each in the order of `all` (sorted by
 * name). Every contact appears once; a chosen one is always offered, so it can be removed.
 */
export function participantOptions(
	all: Contact[],
	leadContacts: string[],
	companyId: string,
	chosen: string[]
): ParticipantOptions {
	const onLead = new Set(leadContacts);
	const picked = new Set(chosen);
	const out: ParticipantOptions = { lead: [], company: [] };
	for (const c of all) {
		if (onLead.has(c.id)) out.lead.push(c);
		else if (companyId && c.company === companyId) out.company.push(c);
		else if (picked.has(c.id)) out.lead.push(c);
	}
	return out;
}

/** Internal participants are only kept for meetings; other types save an empty list. */
export function teamFor(type: ActivityType, team: string[]): string[] {
	return type === 'meeting' ? [...team] : [];
}

/** `ids` with `id` appended once (a newly created contact joins the chosen ones). */
export function withId(ids: string[], id: string): string[] {
	return ids.includes(id) ? [...ids] : [...ids, id];
}
