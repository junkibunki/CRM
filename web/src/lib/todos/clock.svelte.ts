// One shared clock for due states: "today" flips at midnight and a to-do with time turns
// overdue at its minute without a reload. A single timer for all cards (not one per card).
const TICK_MS = 30_000;

export const clock = $state({ now: new Date() });

if (typeof window !== 'undefined') {
	setInterval(() => (clock.now = new Date()), TICK_MS);
	// after standby the interval may be late: refresh when the tab becomes visible again
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') clock.now = new Date();
	});
}
