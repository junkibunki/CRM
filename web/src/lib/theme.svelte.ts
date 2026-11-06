// Light/dark mode. Without a stored choice the app follows the device (and its changes);
// the switch in the user menu stores an explicit choice per browser. The `.dark` class on
// <html> drives the tokens in app.css and the `dark:` variant. app.html sets it before the
// first paint with the same rule (resolveDark), so keep both in step.

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'crm-theme';

/** A stored value that is not 'light' or 'dark' counts as "no choice". */
export function parseTheme(value: string | null | undefined): Theme | null {
	return value === 'light' || value === 'dark' ? value : null;
}

/** An explicit choice wins, otherwise the device decides. */
export function resolveDark(stored: Theme | null, systemDark: boolean): boolean {
	return stored ? stored === 'dark' : systemDark;
}

function readStored(): Theme | null {
	try {
		return parseTheme(localStorage.getItem(THEME_KEY));
	} catch {
		return null; // storage blocked (privacy mode): follow the device
	}
}

export class ThemeStore {
	dark = $state(false);
	// plain fields: they only steer which source decides, nothing renders them
	private stored: Theme | null = null;
	private media: MediaQueryList | null = null;

	constructor() {
		if (typeof window === 'undefined') return;
		this.stored = readStored();
		this.media = window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
		this.media?.addEventListener('change', () => this.update());
		// a choice made in another tab
		window.addEventListener('storage', (e) => {
			if (e.key !== THEME_KEY && e.key !== null) return;
			this.stored = readStored();
			this.update();
		});
		this.update();
	}

	setDark(dark: boolean) {
		this.stored = dark ? 'dark' : 'light';
		try {
			localStorage.setItem(THEME_KEY, this.stored);
		} catch {
			// not stored: the choice lasts until the page is reloaded
		}
		this.update();
	}

	toggle() {
		this.setDark(!this.dark);
	}

	private update() {
		this.dark = resolveDark(this.stored, this.media?.matches ?? false);
		document.documentElement.classList.toggle('dark', this.dark);
	}
}

export const theme = new ThemeStore();
