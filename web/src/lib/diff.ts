/**
 * The fields of `current` that differ from `initial` (the values when a dialog opened).
 * Dialogs save only these: sending the whole form would silently undo changes another
 * user saved to other fields while the dialog was open.
 */
export function changedFields<T extends Record<string, unknown>>(initial: T, current: T): Partial<T> {
	const out: Partial<T> = {};
	for (const key of Object.keys(current) as (keyof T)[]) {
		if (!same(initial[key], current[key])) out[key] = current[key];
	}
	return out;
}

function same(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i]);
	}
	return a === b;
}
