import type { ClientResponseError, RecordModel } from 'pocketbase';
import { auth } from '../auth.svelte';
import { errorMessage, pb } from '../pb';

// Profile pictures: the `avatar` file field of `users` (PocketBase default field, narrowed
// by migration 1793190009_users_avatar.js to these types and a small thumbnail).

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_THUMB = '96x96';

/** Up to two letters for the round fallback: "Anna Berg" -> "AB", "max.muster@x.de" -> "MM". */
export function initials(name?: string | null, email?: string | null): string {
	const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
	const parts = words.length ? words : (email ?? '').split('@')[0].split(/[._+-]+/).filter(Boolean);
	if (!parts.length) return '?';
	const first = parts[0];
	const last = parts.length > 1 ? parts[parts.length - 1] : '';
	return ([...first][0] + ([...last][0] ?? '')).toUpperCase();
}

/** Why this file cannot be a profile picture, or null if it can. */
export function avatarFileError(file: { type: string; size: number }): string | null {
	if (!AVATAR_TYPES.includes(file.type)) return 'Bitte ein Bild im Format JPG, PNG oder WebP wählen.';
	if (file.size > AVATAR_MAX_BYTES) return 'Das Bild ist zu groß (höchstens 5 MB).';
	return null;
}

/** Thumbnail URL of the user's picture, or null without one. */
export function avatarUrl(user: RecordModel | null | undefined): string | null {
	if (!user?.avatar) return null;
	return pb.files.getURL(user, user.avatar, { thumb: AVATAR_THUMB });
}

/**
 * Sets (file) or removes (null) the logged-in user's picture. Resolves an error text or null.
 * The SDK stores the returned record in the auth store, so `auth.user` follows by itself.
 */
export async function saveAvatar(file: File | null): Promise<string | null> {
	const id = pb.authStore.record?.id;
	if (!id) return 'Nicht angemeldet.';
	if (file) {
		const invalid = avatarFileError(file);
		if (invalid) return invalid;
	}
	try {
		await pb.collection('users').update(id, { avatar: file });
		return null;
	} catch (err) {
		// an expired session answers as a guest (404): find out, the guard then logs out
		const status = (err as ClientResponseError).status;
		if (status === 403 || status === 404) auth.refresh();
		return errorMessage(err);
	}
}
