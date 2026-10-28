import type { ClientResponseError, RecordModel } from 'pocketbase';
import { pb } from './pb';

class Auth {
	user = $state<RecordModel | null>(pb.authStore.record);
	// mirrors the token so `loggedIn` re-evaluates on login, logout and refresh
	token = $state(pb.authStore.token);

	constructor() {
		pb.authStore.onChange((token, record) => {
			this.token = token;
			this.user = record;
			this.checkedAt = 0; // login, logout: the last check says nothing about this session
		});
		// An invalidated session (password changed by the admin, token expired) shows up only
		// as guest answers and silent realtime, never as 401 on normal requests. Check it when
		// the tab becomes visible again and once a minute while it is visible.
		if (typeof document !== 'undefined') {
			const check = () => {
				if (document.visibilityState === 'visible' && this.token) this.refresh();
			};
			document.addEventListener('visibilitychange', check);
			setInterval(check, 60_000);
		}
	}

	get loggedIn() {
		return this.token !== '' && this.user !== null && pb.authStore.isValid;
	}

	login(email: string, password: string) {
		return pb.collection('users').authWithPassword(email, password);
	}

	/**
	 * Extends the token and drops the session if it expired or the user was deleted.
	 * Resolves whether the session is still valid. Needed because PocketBase treats an
	 * expired token as a guest: lists come back empty (200), not as 401.
	 *
	 * `maxAge` (ms): reuse a successful check of the same session that is at most this old
	 * instead of asking again (pages that load in steps, e.g. board lookup, then the board).
	 * Without it the session is always checked (after failed writes, reconnects, tab focus).
	 */
	refresh(maxAge = 0): Promise<boolean> {
		const fresh =
			maxAge > 0 &&
			pb.authStore.isValid &&
			this.checkedToken === pb.authStore.token &&
			Date.now() - this.checkedAt <= maxAge;
		if (fresh && !this.pending) return Promise.resolve(true);
		// every live source checks on reconnect; share one request between them
		this.pending ??= this.doRefresh().finally(() => (this.pending = null));
		return this.pending;
	}

	private pending: Promise<boolean> | null = null;
	// last successful check; plain fields, not $state: they only steer refresh()
	private checkedAt = 0;
	private checkedToken = '';

	private async doRefresh(): Promise<boolean> {
		if (!pb.authStore.isValid) {
			this.logout();
			return false;
		}
		try {
			await pb.collection('users').authRefresh();
			// after the SDK stored the new token (its onChange reset checkedAt)
			this.checkedAt = Date.now();
			this.checkedToken = pb.authStore.token;
			return true;
		} catch (err) {
			// keep the session if PocketBase is just unreachable (deploy, restart)
			const status = (err as ClientResponseError).status;
			if (status === 401 || status === 404) {
				this.logout();
				return false;
			}
			return true;
		}
	}

	logout() {
		pb.authStore.clear();
	}
}

export const auth = new Auth();
