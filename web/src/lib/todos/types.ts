import type { RecordModel } from 'pocketbase';
import type { ActivityType } from '../activities/types';

/** A to-do of a lead (collection `todos`, migration 1793190001_todos.js). */
export interface Todo extends RecordModel {
	lead: string;
	title: string;
	/**
	 * PocketBase date string. Without time (`due_has_time` false) it is the calendar day as
	 * `YYYY-MM-DD 00:00:00.000Z`; with time the moment (entered locally, stored as UTC).
	 */
	due: string;
	due_has_time: boolean;
	done: boolean;
	/** set when ticked off, '' while open */
	done_at: string;
	/** the note it was made from, '' if none (or the note was deleted) */
	source_activity: string;
	created_by: string;
	created: string;
	updated: string;
	expand?: { source_activity?: SourceActivity };
}

/** What a to-do list shows of the note a to-do came from (expanded, few fields). */
export type SourceActivity = { id: string; type: ActivityType; subject: string; occurred_at: string };

/** The fields the board loads of each open to-do (one query for the whole pipeline). */
export type OpenTodo = Pick<Todo, 'id' | 'lead' | 'title' | 'due' | 'due_has_time' | 'created'>;

/** Comma list for `fields=` of the board query and subscription. */
export const OPEN_TODO_FIELDS = 'id,lead,title,due,due_has_time,done,created';

/** What the form edits; `due`/`due_has_time` come from fromDueInput(). */
export type TodoData = Pick<Todo, 'title' | 'due' | 'due_has_time'>;

/** A new to-do: the form's data plus, optionally, the note it is made from. */
export type NewTodo = TodoData & { source_activity?: string };

export type DueStatus = 'overdue' | 'today' | 'future';

// server limit (migration); the form checks it first for a German message
export const MAX_TITLE = 300;
