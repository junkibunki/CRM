import PocketBase, { ClientResponseError } from 'pocketbase';

// Same origin in prod (served from pb_public) and in dev (Vite proxy).
export const pb = new PocketBase('/');

// Each store subscribes and loads on its own; don't let the SDK cancel parallel requests.
pb.autoCancellation(false);

// A 401 (e.g. from auth-refresh): drop the session, the layout guard then sends the user
// to /login. Note that PocketBase answers most requests with an expired token as for a
// guest (empty lists, 404), not 401 — that case is caught by auth.refresh(): before every
// liveSync load, after failed writes, on tab focus and once a minute.
pb.afterSend = (response, data) => {
	if (response.status === 401 && pb.authStore.token) pb.authStore.clear();
	return data;
};

export function errorMessage(err: unknown): string {
	if (err instanceof ClientResponseError) {
		if (err.status === 404) return 'Der Datensatz wurde inzwischen gelöscht.';
		// field validation errors carry the useful part in data: {field: {code, message}}
		const fields = Object.entries(err.response?.data ?? {})
			.map(([field, v]) => `${field}: ${(v as { message?: string })?.message ?? ''}`)
			.join(', ');
		return fields || err.message || 'Anfrage fehlgeschlagen.';
	}
	return err instanceof Error ? err.message : String(err);
}

/** A delete fails with 400 when a required relation (e.g. a lead) still points at the record. */
export function deleteErrorMessage(err: unknown, usedBy: string): string {
	if (err instanceof ClientResponseError && err.status === 400) {
		return `Kann nicht gelöscht werden, solange ${usedBy} darauf verweist.`;
	}
	return errorMessage(err);
}
