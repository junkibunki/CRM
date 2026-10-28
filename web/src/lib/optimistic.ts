// Shared by the stores with optimistic writes and ranks (BoardStore, LeadStore): how a failed
// write is read, how it is rolled back, and how a whole list gets fresh ranks.
import { ClientResponseError } from 'pocketbase';
import { auth } from './auth.svelte';
import { same } from './diff';
import { pb } from './pb';

// Keys grow by about a character every few inserts at the same spot; well below the
// schema's max of 100, re-rank the list instead of letting the save fail (kanban.md).
export const MAX_RANK_LENGTH = 50;

// Requests per batch: must not exceed `batch.maxRequests` (migration 1793190007_f13b.js).
export const BATCH_MAX = 1000;

/**
 * The record no longer exists (deleted by someone else). A 404 can also mean our session
 * became invalid (PocketBase then answers as for a guest), so the session is checked
 * first; if it is invalid, auth.refresh() logs out and this is not treated as "gone".
 */
export async function isGone(err: unknown) {
	if (!(err instanceof ClientResponseError && err.status === 404)) return false;
	return auth.refresh();
}

/**
 * A failed create or re-rank may mean our session became invalid (PocketBase answers a guest with
 * 400/403/404): check it, so the user is sent to the login instead of seeing a generic error.
 */
export async function checkSession(err: unknown) {
	if (err instanceof ClientResponseError && [400, 403, 404].includes(err.status)) {
		await auth.refresh();
	}
}

/**
 * Counts realtime events per record, so a failed write can tell whether the server's state
 * arrived while it was in flight. Plain Map, not $state: it only steers a rollback.
 */
export class RealtimeMarks {
	private counts = new Map<string, number>();

	/** call for every realtime create/update of `id` (also the merge after a reconnect) */
	note(id: string) {
		this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
	}

	/** take before sending a write; pass to `since` when it failed */
	mark(id: string): number {
		return this.counts.get(id) ?? 0;
	}

	/** an event for `id` arrived after `mark` was taken */
	since(id: string, mark: number): boolean {
		return this.mark(id) !== mark;
	}
}

/**
 * Undoes a failed optimistic update: only fields that still hold our value. A field that
 * changed since (realtime event of someone else) keeps the newer value.
 *
 * `eventSince`: a realtime event for the record arrived while the request was in flight.
 * It carried the server's whole record (every field), which realtime already applied, so
 * nothing is rolled back — also not a field someone else saved with *our* value meanwhile,
 * which would otherwise be indistinguishable from our own optimistic value.
 */
export function rollback<T extends object>(
	target: T,
	prev: Partial<T>,
	ours: Partial<T>,
	eventSince = false
) {
	if (eventSince) return;
	for (const key of Object.keys(ours) as (keyof T)[]) {
		if (same(target[key], ours[key])) target[key] = prev[key] as T[keyof T];
	}
}

/**
 * Saves new ranks for a whole list through the batch API: one transaction per BATCH_MAX
 * records, so nobody sees a half re-ranked list (all of it or nothing is saved). Resolves the
 * number of saved entries or rejects with a RankSaveError, whose `saved` says how many
 * leading entries made it (only > 0 for lists longer than BATCH_MAX).
 */
export async function saveRanks(
	collection: string,
	entries: { id: string; rank: string }[]
): Promise<number> {
	let saved = 0;
	while (saved < entries.length) {
		const chunk = entries.slice(saved, saved + BATCH_MAX);
		const batch = pb.createBatch();
		for (const e of chunk) batch.collection(collection).update(e.id, { rank: e.rank });
		try {
			await batch.send();
		} catch (error) {
			throw new RankSaveError(saved, error);
		}
		saved += chunk.length;
	}
	return saved;
}

/** Rejection of saveRanks(): `saved` leading entries are stored, the rest kept their old rank. */
export class RankSaveError extends Error {
	constructor(
		readonly saved: number,
		readonly error: unknown
	) {
		super('re-rank failed');
	}
}
