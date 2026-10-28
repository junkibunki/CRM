// The signed-in user's API tokens (F15), live: realtime shows `last_used` as the MCP server
// uses a token. The API rules return only the user's own tokens, never their hash.
// Creating goes through the hook route (the token is in that response only); revoking is
// deleting the record.
import { auth } from '../auth.svelte';
import { liveSync } from '../live';
import { errorMessage, pb } from '../pb';
import { byCreatedDesc, type ApiToken } from './format';

const FIELDS = 'id,user,name,last_used,created,updated';

/** the signed-in user (the SDK's store: always the session the requests go out with) */
const me = () => pb.authStore.record?.id;

/** What the create route answers. */
export type NewToken = { id: string; name: string; created: string; token: string };

export class TokenStore {
	items = $state<ApiToken[]>([]);
	loaded = $state(false);
	error = $state('');

	/** Starts loading + realtime; returns the teardown (call from a component's $effect). */
	use(): () => void {
		return liveSync<ApiToken[]>({
			subscribe: (handle) => [
				pb.collection('api_tokens').subscribe<ApiToken>('*', (e) => handle(() => this.onEvent(e.action, e.record)), {
					fields: FIELDS
				})
			],
			fetch: () => pb.collection('api_tokens').getFullList<ApiToken>({ sort: '-created', fields: FIELDS }),
			apply: (list) => {
				// a session for another user (or none): never show foreign rows
				const user = me();
				this.items.splice(0, this.items.length, ...list.filter((t) => t.user === user).sort(byCreatedDesc));
			},
			onError: (err) => (this.error = errorMessage(err)),
			onSettled: () => (this.loaded = true)
		});
	}

	private onEvent(action: string, rec: ApiToken) {
		const i = this.items.findIndex((t) => t.id === rec.id);
		if (action === 'delete') {
			if (i !== -1) this.items.splice(i, 1);
			return;
		}
		const plain = pick(rec);
		if (i !== -1) {
			// an older event must not undo a newer state (e.g. last_used)
			if (this.items[i].updated <= plain.updated) this.items[i] = plain;
		} else if (plain.user === me()) {
			this.insert(plain);
		}
	}

	private insert(t: ApiToken) {
		// dedupe: the create response and the realtime event bring the same record
		if (this.items.some((x) => x.id === t.id)) return;
		const at = this.items.findIndex((x) => byCreatedDesc(t, x) < 0);
		if (at === -1) this.items.push(t);
		else this.items.splice(at, 0, t);
	}

	/** Creates a token; returns it (shown once) or null with `error` set. */
	async create(name: string): Promise<NewToken | null> {
		this.error = '';
		try {
			const res = await pb.send<NewToken>('/api/crm/api-tokens', { method: 'POST', body: { name } });
			this.insert({ id: res.id, user: me() ?? '', name: res.name, last_used: '', created: res.created, updated: res.created });
			return res;
		} catch (err) {
			this.error = errorMessage(err);
			auth.refresh();
			return null;
		}
	}

	/** Revokes (deletes) a token; false with `error` set if that failed. */
	async revoke(id: string): Promise<boolean> {
		this.error = '';
		try {
			await pb.collection('api_tokens').delete(id);
		} catch (err) {
			// already gone (revoked elsewhere): that is what we wanted
			if ((err as { status?: number })?.status !== 404) {
				this.error = errorMessage(err);
				return false;
			}
			auth.refresh();
		}
		const i = this.items.findIndex((t) => t.id === id);
		if (i !== -1) this.items.splice(i, 1);
		return true;
	}

	clearError() {
		this.error = '';
	}
}

function pick(r: ApiToken): ApiToken {
	return { id: r.id, user: r.user, name: r.name, last_used: r.last_used ?? '', created: r.created, updated: r.updated };
}
