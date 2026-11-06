import type { BoardColumn } from '#lib/types.js';

/** title a new lead starts with: the usual case is showing someone Mendix */
export const DEFAULT_LEAD_TITLE = 'Mendix Landing';

/**
 * Stage a lead created through "Neuer Lead" (page header) lands in: the first open stage of
 * the pipeline (columns come sorted by rank). Closed stages (won/lost) are never an entry;
 * null when there is no open stage, the button is then disabled.
 */
export function entryColumn(columns: readonly BoardColumn[]): BoardColumn | null {
	return columns.find((c) => !c.closed) ?? null;
}
