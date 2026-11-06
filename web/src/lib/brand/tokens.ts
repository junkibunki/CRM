// Reads the colour tokens out of blueberk.css so the tests can check contrast without a
// browser. Only what that file uses: hex colours and var(--x) references to the palette.

export type Tokens = Record<string, string>;

/** The custom properties of a CSS fragment, in order; later ones win. */
function declarations(css: string): Tokens {
	const out: Tokens = {};
	for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) out[m[1]] = m[2].trim();
	return out;
}

/** Rule blocks (selector + body) at the top level; nested at-rule bodies are skipped. */
function blocks(css: string): { selector: string; body: string }[] {
	const out: { selector: string; body: string }[] = [];
	let depth = 0;
	let start = 0;
	let open = 0;
	for (let i = 0; i < css.length; i++) {
		if (css[i] === '{') {
			if (depth === 0) open = i;
			depth++;
		} else if (css[i] === '}') {
			depth--;
			if (depth === 0) {
				out.push({ selector: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
				start = i + 1;
			}
		} else if (css[i] === ';' && depth === 0) start = i + 1; // @import ...;
	}
	return out;
}

/** Light (`:root`) and dark (`.dark`) token sets. Dark inherits what it does not override. */
export function parseTokens(css: string): { light: Tokens; dark: Tokens } {
	const all = blocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));
	const pick = (selector: string) =>
		Object.assign({}, ...all.filter((b) => b.selector === selector).map((b) => declarations(b.body)));
	const light: Tokens = pick(':root');
	return { light, dark: { ...light, ...pick('.dark') } };
}

/** Follows var(--x) chains to the final value; throws on unknown or circular names. */
export function resolve(tokens: Tokens, name: string, seen: string[] = []): string {
	if (seen.includes(name)) throw new Error(`circular token: ${[...seen, name].join(' -> ')}`);
	const value = tokens[name];
	if (value === undefined) throw new Error(`unknown token: ${name}`);
	const ref = /^var\((--[\w-]+)\)$/.exec(value);
	return ref ? resolve(tokens, ref[1], [...seen, name]) : value;
}

/** #rgb or #rrggbb to 0..255 channels. */
export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a hex colour: ${hex}`);
	const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance. */
export function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21, order of the arguments does not matter. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
