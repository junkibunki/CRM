import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, hexToRgb, luminance, parseTokens, resolve } from './tokens.js';

describe('contrast helpers', () => {
	it('parses short and long hex', () => {
		expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
		expect(hexToRgb('#2d3042')).toEqual([45, 48, 66]);
		expect(() => hexToRgb('rgb(0 0 0)')).toThrow(/not a hex/);
	});

	it('matches the WCAG reference values', () => {
		expect(luminance('#000000')).toBe(0);
		expect(luminance('#ffffff')).toBeCloseTo(1);
		expect(contrast('#000', '#fff')).toBeCloseTo(21);
		expect(contrast('#fff', '#000')).toBeCloseTo(21);
		expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
	});
});

describe('parseTokens / resolve', () => {
	const sample = `
		@import 'x';
		:root { --a: #111111; --b: var(--a); /* --c: #ignored; */ }
		.dark { --b: #eeeeee; }
		@layer utilities { button { --a: #ignored; } }
		.bb-logo { --d: #ignored; }`;

	it('splits light and dark, dark inherits the rest', () => {
		const { light, dark } = parseTokens(sample);
		expect(light).toEqual({ '--a': '#111111', '--b': 'var(--a)' });
		expect(dark).toEqual({ '--a': '#111111', '--b': '#eeeeee' });
	});

	it('follows var() chains and rejects unknown or circular names', () => {
		const { light } = parseTokens(sample);
		expect(resolve(light, '--b')).toBe('#111111');
		expect(() => resolve(light, '--nope')).toThrow(/unknown/);
		expect(() => resolve({ '--x': 'var(--y)', '--y': 'var(--x)' }, '--x')).toThrow(/circular/);
	});
});

describe('blueberk.css', () => {
	// read from disk: vitest hands CSS imports (also ?raw) back empty, and under jsdom
	// import.meta.url is no file: URL. vitest runs from web/.
	const css = readFileSync('src/lib/brand/blueberk.css', 'utf8');
	const { light, dark } = parseTokens(css);

	// every colour the shadcn components and app.css map in @theme
	const REQUIRED = [
		'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
		'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
		'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border', 'input',
		'ring', 'link'
	];

	it.each(['light', 'dark'] as const)('defines every semantic token (%s)', (mode) => {
		const tokens = mode === 'light' ? light : dark;
		for (const name of REQUIRED) expect(() => resolve(tokens, `--${name}`)).not.toThrow();
	});

	it('uses the BlueBerk palette for the brand-carrying tokens', () => {
		expect(resolve(light, '--primary')).toBe('#2d3042');
		expect(resolve(dark, '--primary')).toBe('#abd737');
		expect(resolve(dark, '--ring')).toBe('#abd737');
		expect(resolve(light, '--foreground')).toBe('#17252a');
	});

	// focus ring and other non-text UI: WCAG 1.4.11 asks for 3:1 against the surface
	it.each(['light', 'dark'] as const)('keeps the focus ring visible (%s)', (mode) => {
		const tokens = mode === 'light' ? light : dark;
		for (const bg of ['background', 'card']) {
			expect(contrast(resolve(tokens, '--ring'), resolve(tokens, `--${bg}`))).toBeGreaterThanOrEqual(3);
		}
	});

	// text on its surface must reach WCAG AA (4.5:1) in both modes
	const TEXT_PAIRS: [string, string][] = [
		['foreground', 'background'],
		['card-foreground', 'card'],
		['popover-foreground', 'popover'],
		['primary-foreground', 'primary'],
		['secondary-foreground', 'secondary'],
		['muted-foreground', 'muted'],
		['muted-foreground', 'background'],
		['muted-foreground', 'card'],
		['accent-foreground', 'accent'],
		['link', 'background'],
		['link', 'card'],
		['destructive', 'card']
	];

	it.each(['light', 'dark'] as const)('keeps text readable (%s)', (mode) => {
		const tokens = mode === 'light' ? light : dark;
		const failing = TEXT_PAIRS.map(([fg, bg]) => ({
			pair: `${fg} on ${bg}`,
			ratio: contrast(resolve(tokens, `--${fg}`), resolve(tokens, `--${bg}`))
		})).filter((p) => p.ratio < 4.5);
		expect(failing).toEqual([]);
	});
});
