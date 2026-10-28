// "aus Notiz vom …" (a to-do on the lead page) → that note in the timeline on the same page.
// The timeline registers itself; it knows its filter and can reset it when that hides the note.
import { matchesFilter } from './format';
import type { Activity, ActivityFilter } from './types';

type Handler = (activityId: string) => boolean;
const handlers = new Set<Handler>();

/** The timeline: `show` reveals the activity and returns true, or false if it doesn't have it. */
export function onRevealActivity(show: Handler): () => void {
	handlers.add(show);
	return () => handlers.delete(show);
}

/** Asks the timeline to show an activity; false when no timeline on the page has it. */
export function revealActivity(activityId: string): boolean {
	for (const show of handlers) if (show(activityId)) return true;
	return false;
}

/** The filter under which `activity` is visible: the current one if it shows it, else "Alle". */
export function filterShowing(activity: Pick<Activity, 'type'>, filter: ActivityFilter): ActivityFilter {
	return matchesFilter(activity, filter) ? filter : 'all';
}
