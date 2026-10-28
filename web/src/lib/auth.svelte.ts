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
		});
	}

	get loggedIn() {
		return this.token !== '' && this.user !== null && pb.authStore.isValid;
	}

	login(email: string, password: string) {
		return pb.collection('users').authWithPassword(email, password);
	}

	// Extends the token and drops the session if the user was deleted or the token expired.
	async refresh() {
		if (!pb.authStore.isValid) return this.logout();
		try {
			await pb.collection('users').authRefresh();
		} catch (err) {
			// keep the session if PocketBase is just unreachable (deploy, restart)
			const status = (err as ClientResponseError).status;
			if (status === 401 || status === 404) this.logout();
		}
	}

	logout() {
		pb.authStore.clear();
	}
}

export const auth = new Auth();
