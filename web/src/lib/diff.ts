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

/** Equal values; arrays by content and order. */
export function same(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i]);
	}
	return a === b;
}

export type ListDelta = { add: string[]; remove: string[] };

/**
 * What was added to and removed from a list of ids (e.g. a relation) between `initial`
 * and `current`. Sent as PocketBase's `field+` / `field-` modifiers, so ids another user
 * added or removed in the meantime are kept instead of being overwritten by the whole list.
 */
export function listDelta(initial: string[], current: string[]): ListDelta {
	return {
		add: current.filter((id) => !initial.includes(id)),
		remove: initial.filter((id) => !current.includes(id))
	};
}

/** `list` with the delta applied the way PocketBase does it: removed ids out, new ids appended once. */
export function applyDelta(list: string[], delta: ListDelta): string[] {
	const out = list.filter((id) => !delta.remove.includes(id));
	for (const id of delta.add) if (!out.includes(id)) out.push(id);
	return out;
}
