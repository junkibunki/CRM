// Writes shared by the to-do stores (board and lead page).
import { ClientResponseError } from 'pocketbase';
import { auth } from '../auth.svelte';
import { pb } from '../pb';
import type { NewTodo, Todo } from './types';

/**
 * Classifies a failed write. A 404 means "deleted by someone else" — unless our session became
 * invalid (PocketBase then answers as for a guest with 400/403/404), so the session is checked
 * first; if it is invalid, auth.refresh() logs out and the result is 'error'.
 */
export async function writeFailure(err: unknown): Promise<'gone' | 'error'> {
	if (err instanceof ClientResponseError && [400, 403, 404].includes(err.status)) {
		const valid = await auth.refresh();
		if (valid && err.status === 404) return 'gone';
	}
	return 'error';
}

/** now as a PocketBase date string */
export function nowPb() {
	return new Date().toISOString().replace('T', ' ');
}

/** Fields for ticking a to-do off (`done_at` set) or taking it back (`done_at` cleared). */
export function doneFields(done: boolean): Pick<Todo, 'done' | 'done_at'> {
	return { done, done_at: done ? nowPb() : '' };
}

/** Creates a to-do of `leadId` as the current user; throws on failure (session checked). */
export async function createTodo<T = Todo>(
	leadId: string,
	data: NewTodo,
	options?: Record<string, unknown>
): Promise<T> {
	const body = {
		...data,
		lead: leadId,
		done: false,
		created_by: pb.authStore.record?.id ?? ''
	};
	try {
		return await pb.collection('todos').create<T>(body, options);
	} catch (err) {
		await writeFailure(err);
		throw err;
	}
}
