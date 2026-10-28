import type { RecordModel } from 'pocketbase';
import { pb } from '../pb';

// Attachments are protected files: every URL needs a file token (pb.files.getToken()),
// which PocketBase only accepts for a few minutes. URLs are therefore never stored in a
// store; they are built when needed. Previews and sizes share a token for TOKEN_TTL (well
// below PocketBase's lifetime), downloads always ask for a fresh one.
export const TOKEN_TTL = 60_000;

let cached: { auth: string; token: string; at: number } | null = null;
let pending: Promise<string> | null = null;

/** a file token for previews/sizes; `fresh` forces a new one (e.g. after a failed image) */
export function fileToken(fresh = false): Promise<string> {
	const auth = pb.authStore.token;
	if (!fresh && cached && cached.auth === auth && Date.now() - cached.at < TOKEN_TTL) {
		return Promise.resolve(cached.token);
	}
	// several previews becoming visible at once share one request
	pending ??= pb.files
		.getToken()
		.then((token) => {
			cached = { auth, token, at: Date.now() };
			return token;
		})
		.finally(() => (pending = null));
	return pending;
}

/** forget the shared token (tests, logout) */
export function resetFileToken() {
	cached = null;
	pending = null;
}

export async function thumbUrl(record: RecordModel, name: string, fresh = false) {
	return pb.files.getURL(record, name, { token: await fileToken(fresh), thumb: '200x200f' });
}

/** size in bytes from a HEAD request (the record only stores file names), null if unknown */
export async function fileSize(record: RecordModel, name: string): Promise<number | null> {
	const url = pb.files.getURL(record, name, { token: await fileToken() });
	const res = await fetch(url, { method: 'HEAD' });
	const len = res.ok ? Number(res.headers.get('content-length')) : NaN;
	return Number.isFinite(len) ? len : null;
}

/** Starts the download of an attachment with a freshly created token (call on click). */
export async function downloadAttachment(record: RecordModel, name: string) {
	const token = await pb.files.getToken();
	const a = document.createElement('a');
	a.href = pb.files.getURL(record, name, { token, download: true });
	a.rel = 'noopener';
	a.download = '';
	document.body.append(a);
	a.click();
	a.remove();
}
