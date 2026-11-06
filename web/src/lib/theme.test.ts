import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTheme, resolveDark, THEME_KEY, ThemeStore } from './theme.svelte';

describe('parseTheme', () => {
	it('accepts only light and dark', () => {
		expect(parseTheme('light')).toBe('light');
		expect(parseTheme('dark')).toBe('dark');
		expect(parseTheme('Dark')).toBeNull();
		expect(parseTheme('')).toBeNull();
		expect(parseTheme(null)).toBeNull();
	});
});

describe('resolveDark', () => {
	it('follows the device without a stored choice', () => {
		expect(resolveDark(null, true)).toBe(true);
		expect(resolveDark(null, false)).toBe(false);
	});

	it('lets a stored choice win over the device', () => {
		expect(resolveDark('light', true)).toBe(false);
		expect(resolveDark('dark', false)).toBe(true);
	});
});

describe('ThemeStore', () => {
	let systemDark: boolean;
	let listeners: (() => void)[];

	function setSystem(dark: boolean) {
		systemDark = dark;
		listeners.forEach((cb) => cb());
	}

	beforeEach(() => {
		systemDark = false;
		listeners = [];
		localStorage.clear();
		document.documentElement.classList.remove('dark');
		vi.stubGlobal('matchMedia', (query: string) => ({
			media: query,
			get matches() {
				return systemDark;
			},
			addEventListener: (_: string, cb: () => void) => listeners.push(cb)
		}));
	});

	afterEach(() => vi.unstubAllGlobals());

	const isDarkClass = () => document.documentElement.classList.contains('dark');

	it('starts with the device setting and follows its changes', () => {
		systemDark = true;
		const t = new ThemeStore();
		expect(t.dark).toBe(true);
		expect(isDarkClass()).toBe(true);
		setSystem(false);
		expect(t.dark).toBe(false);
		expect(isDarkClass()).toBe(false);
	});

	it('starts with a stored choice', () => {
		systemDark = true;
		localStorage.setItem(THEME_KEY, 'light');
		const t = new ThemeStore();
		expect(t.dark).toBe(false);
		expect(isDarkClass()).toBe(false);
	});

	it('stores the switch and then ignores the device', () => {
		const t = new ThemeStore();
		t.setDark(true);
		expect(localStorage.getItem(THEME_KEY)).toBe('dark');
		expect(isDarkClass()).toBe(true);
		setSystem(false);
		expect(t.dark).toBe(true);
		t.toggle();
		expect(t.dark).toBe(false);
		expect(localStorage.getItem(THEME_KEY)).toBe('light');
		expect(isDarkClass()).toBe(false);
	});

	it('takes over a choice made in another tab', () => {
		const t = new ThemeStore();
		localStorage.setItem(THEME_KEY, 'dark');
		window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
		expect(t.dark).toBe(true);
		expect(isDarkClass()).toBe(true);
	});

	it('still switches when storage is blocked', () => {
		const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		systemDark = true;
		const t = new ThemeStore();
		expect(t.dark).toBe(true);
		t.setDark(false);
		expect(t.dark).toBe(false);
		expect(isDarkClass()).toBe(false);
		get.mockRestore();
		set.mockRestore();
	});
});
