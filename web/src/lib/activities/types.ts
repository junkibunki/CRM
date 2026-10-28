import type { RecordModel } from 'pocketbase';

export type ActivityType = 'note' | 'meeting' | 'email_in' | 'email_out';

/** An activity of a lead (collection `activities`, migration 1793190000_activities.js). */
export interface Activity extends RecordModel {
	lead: string;
	type: ActivityType;
	subject: string;
	/** HTML from the rich-text editor; always display through sanitizeHtml() */
	body: string;
	/** PocketBase date string: when it happened (not when it was entered) */
	occurred_at: string;
	contacts: string[];
	/** stored file names (protected: download needs a file token) */
	attachments: string[];
	author: string;
	created: string;
	updated: string;
}

/** The fields the form edits; only the changed ones are sent on update. */
export type ActivityData = Pick<Activity, 'type' | 'subject' | 'body' | 'occurred_at' | 'contacts'>;

export const ACTIVITY_TYPES: { key: ActivityType; label: string }[] = [
	{ key: 'note', label: 'Notiz' },
	{ key: 'meeting', label: 'Meeting-Notiz' },
	{ key: 'email_in', label: 'E-Mail eingegangen' },
	{ key: 'email_out', label: 'E-Mail gesendet' }
];

export function typeLabel(type: ActivityType) {
	return ACTIVITY_TYPES.find((t) => t.key === type)?.label ?? type;
}

export type ActivityFilter = 'all' | 'note' | 'meeting' | 'email';

export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
	{ key: 'all', label: 'Alle' },
	{ key: 'note', label: 'Notizen' },
	{ key: 'meeting', label: 'Meetings' },
	{ key: 'email', label: 'E-Mails' }
];

// server limits (migration); checked in the form first for a German message
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
export const MAX_BODY_SIZE = 1024 * 1024;
