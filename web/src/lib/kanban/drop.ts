// Where a drop lands, as pure functions (unit-tested in drop.test.ts).
// Indices are counted WITHOUT the dragged item, as BoardStore.moveLead/moveColumn expect.

type Item = { id: string };
type Edge = 'top' | 'bottom' | 'left' | 'right' | null;

export type CardTarget =
	| { kind: 'card'; cardId: string; columnId: string; edge: Edge }
	| { kind: 'list'; columnId: string };

/** Target column and index for a dragged card, or null when nothing changes. */
export function cardDrop(
	leadsByColumn: Record<string, Item[]>,
	draggedId: string,
	target: CardTarget
): { columnId: string; toIndex: number } | null {
	const list = leadsByColumn[target.columnId] ?? [];
	const others = list.filter((l) => l.id !== draggedId);
	let toIndex: number;
	if (target.kind === 'card') {
		if (target.cardId === draggedId) return null; // dropped onto itself
		const i = others.findIndex((l) => l.id === target.cardId);
		if (i === -1) return null;
		toIndex = target.edge === 'bottom' ? i + 1 : i;
	} else {
		toIndex = others.length;
	}
	// unchanged position (same column, same slot): nothing to save
	if (list.findIndex((l) => l.id === draggedId) === toIndex) return null;
	return { columnId: target.columnId, toIndex };
}

/** Target index for a dragged column, or null when nothing changes. */
export function columnDrop(
	columns: Item[],
	draggedId: string,
	targetId: string,
	edge: Edge
): number | null {
	if (draggedId === targetId) return null;
	const others = columns.filter((c) => c.id !== draggedId);
	const i = others.findIndex((c) => c.id === targetId);
	if (i === -1) return null;
	const toIndex = edge === 'right' ? i + 1 : i;
	if (columns.findIndex((c) => c.id === draggedId) === toIndex) return null;
	return toIndex;
}
