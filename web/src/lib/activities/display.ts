// Display helpers of a timeline entry (ActivityItem): remembered "Bilder anzeigen" and the
// measured "mehr" for long texts.

// per user: on a shared device the next person doesn't inherit someone's opt-in
const imagesKey = (userId: string) => `crm.activities.showImages.${userId}`;
// enough for the notes someone actually opened images on; the oldest are dropped
export const MAX_REMEMBERED = 300;

function readAllowed(userId: string): string[] {
	try {
		const v = JSON.parse(localStorage.getItem(imagesKey(userId)) ?? '[]');
		return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
	} catch {
		return []; // no storage (private mode, blocked) or garbage: nothing remembered
	}
}

/** `userId` clicked "Bilder anzeigen" for this activity (in this browser), also before a reload. */
export function imagesAllowed(userId: string, activityId: string): boolean {
	return !!userId && readAllowed(userId).includes(activityId);
}

/** Remembers "Bilder anzeigen" of `userId` for this activity (newest last, at most MAX_REMEMBERED). */
export function allowImages(userId: string, activityId: string) {
	if (!userId) return; // not signed in: shown for now, not remembered
	const list = readAllowed(userId).filter((id) => id !== activityId);
	list.push(activityId);
	try {
		localStorage.setItem(imagesKey(userId), JSON.stringify(list.slice(-MAX_REMEMBERED)));
	} catch {
		// storage full or blocked: shown for now, just not remembered
	}
}

/** Height of the collapsed text (`max-h-32`): 8rem. */
export const COLLAPSED_REM = 8;

/** `rem` in px for the current root font size (16 if it can't be read). */
export function remToPx(rem: number): number {
	const size = typeof document !== 'undefined' ? parseFloat(getComputedStyle(document.documentElement).fontSize) : NaN;
	return rem * (Number.isFinite(size) && size > 0 ? size : 16);
}

/**
 * Watches the rendered height of a text's content (the element inside the clipping box, so
 * it has its full height) and reports whether it is taller than `limitPx` — i.e. whether it
 * needs "mehr". Returns the teardown; without ResizeObserver it reports nothing (the caller
 * keeps its estimate).
 */
export function watchOverflow(content: HTMLElement, limitPx: () => number, report: (long: boolean) => void) {
	if (typeof ResizeObserver === 'undefined') return () => {};
	const check = () => report(content.offsetHeight > limitPx() + 1);
	const ro = new ResizeObserver(check);
	ro.observe(content);
	return () => ro.disconnect();
}
