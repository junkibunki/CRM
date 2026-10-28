import type { UnsubscribeFunc } from 'pocketbase';
import { auth } from './auth.svelte';
import { pb } from './pb';

// A page often starts its live sources one after another (the leads page: board lookup,
// then the board). For a first load, a session check this young is reused instead of
// asking again; reloads after a reconnect always check.
const SESSION_REUSE_MS = 5_000;

type Options<T> = {
	/** Register realtime subscriptions; route every event through `handle`. */
	subscribe: (handle: (apply: () => void) => void) => Promise<UnsubscribeFunc>[];
	fetch: () => Promise<T>;
	/** `first` is true for the initial load, false for reloads after a reconnect. */
	apply: (data: T, first: boolean) => void;
	onError: (err: unknown) => void;
	/** Runs after every load attempt that is still the latest one. */
	onSettled?: () => void;
};

/**
 * Subscribe-then-load with no gaps:
 * - events arriving while a load runs are buffered and replayed after it, in order
 *   (events older than the snapshot are idempotent, the last one wins);
 * - after a reconnect (sleep, network drop, idle timeout) the data is fetched again,
 *   because the SDK resubscribes but never delivers missed events;
 * - if loads overlap (connection flapping), only the latest one applies.
 * Returns the teardown; call from a component's $effect.
 */
export function liveSync<T>(opts: Options<T>): () => void {
	// plain variables, not $state: they only steer loading (see CLAUDE.md)
	let stopped = false;
	let started = false;
	let loadedOnce = false;
	let generation = 0;
	let queue: (() => void)[] | null = [];
	const unsubs: UnsubscribeFunc[] = [];

	const handle = (apply: () => void) => {
		if (stopped) return;
		if (queue) queue.push(apply);
		else apply();
	};

	const load = async () => {
		const mine = ++generation;
		queue ??= [];
		try {
			// With an invalid session PocketBase answers as for a guest (empty lists, 404), so
			// check it before every load, the first one included (which may reuse a check from
			// the last few seconds); refresh() logs out if needed.
			if (!(await auth.refresh(loadedOnce ? 0 : SESSION_REUSE_MS))) return;
			const data = await opts.fetch();
			if (stopped || mine !== generation) return;
			opts.apply(data, !loadedOnce);
			loadedOnce = true;
		} catch (err) {
			if (!stopped && mine === generation) opts.onError(err);
		} finally {
			if (!stopped && mine === generation) {
				const pending = queue ?? [];
				queue = null;
				pending.forEach((apply) => apply());
				opts.onSettled?.();
			}
		}
	};

	(async () => {
		// allSettled, not all: if one subscription fails, the others must still be kept so
		// the teardown can unsubscribe them
		const results = await Promise.allSettled([
			...opts.subscribe(handle),
			// the initial connect happens before `started`; every later one is a reconnect.
			// Also reloads after a failed first load (e.g. opened while offline).
			pb.realtime.subscribe('PB_CONNECT', () => {
				if (started && !stopped) load();
			})
		]);
		for (const r of results) {
			if (r.status === 'rejected') {
				if (!stopped) opts.onError(r.reason);
			} else if (stopped) r.value();
			else unsubs.push(r.value);
		}
		if (stopped) return;
		started = true;
		await load();
	})();

	return () => {
		stopped = true;
		unsubs.forEach((u) => u());
	};
}
