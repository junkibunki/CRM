import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowImages, imagesAllowed, MAX_REMEMBERED, remToPx, watchOverflow } from './display';

describe('"Bilder anzeigen" is remembered', () => {
	beforeEach(() => localStorage.clear());

	it('per user and activity, across a reload (localStorage)', () => {
		expect(imagesAllowed('u1', 'a1')).toBe(false);
		allowImages('u1', 'a1');
		expect(imagesAllowed('u1', 'a1')).toBe(true);
		expect(imagesAllowed('u1', 'a2')).toBe(false);
		expect(JSON.parse(localStorage.getItem('crm.activities.showImages.u1')!)).toEqual(['a1']);
	});

	it('another user on the same device does not inherit the opt-in', () => {
		allowImages('u1', 'a1');
		expect(imagesAllowed('u2', 'a1')).toBe(false);
		// without a signed-in user nothing is remembered or read
		allowImages('', 'a2');
		expect(imagesAllowed('', 'a1')).toBe(false);
		expect(imagesAllowed('', 'a2')).toBe(false);
		expect(Object.keys(localStorage)).toEqual(['crm.activities.showImages.u1']);
	});

	it('keeps only the newest MAX_REMEMBERED ids, without duplicates', () => {
		for (let i = 0; i < MAX_REMEMBERED + 10; i++) allowImages('u1', `a${i}`);
		allowImages('u1', 'a20'); // again: moves to the end
		expect(imagesAllowed('u1', 'a0')).toBe(false);
		expect(imagesAllowed('u1', 'a20')).toBe(true);
		const list = JSON.parse(localStorage.getItem('crm.activities.showImages.u1')!);
		expect(list).toHaveLength(MAX_REMEMBERED);
		expect(list.at(-1)).toBe('a20');
		expect(new Set(list).size).toBe(list.length);
	});

	it('copes with garbage or blocked storage', () => {
		localStorage.setItem('crm.activities.showImages.u1', '{kaputt');
		expect(imagesAllowed('u1', 'a1')).toBe(false);
		const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(imagesAllowed('u1', 'a1')).toBe(false);
		expect(() => allowImages('u1', 'a1')).not.toThrow();
		get.mockRestore();
		set.mockRestore();
	});
});

describe('watchOverflow: "mehr" by the measured height', () => {
	let observed: { cb: () => void; el: Element; disconnected: boolean }[] = [];
	const Orig = globalThis.ResizeObserver;

	beforeEach(() => {
		observed = [];
		globalThis.ResizeObserver = class {
			entry: (typeof observed)[number] | undefined;
			constructor(private cb: () => void) {}
			observe(el: Element) {
				this.entry = { cb: this.cb, el, disconnected: false };
				observed.push(this.entry);
			}
			unobserve() {}
			disconnect() {
				if (this.entry) this.entry.disconnected = true;
			}
		} as unknown as typeof ResizeObserver;
	});
	afterEach(() => {
		globalThis.ResizeObserver = Orig;
	});

	function content(height: number) {
		const el = document.createElement('div');
		Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
		return el;
	}

	it('reports long only when the content is taller than the collapsed box', () => {
		const reports: boolean[] = [];
		const short = content(100);
		watchOverflow(short, () => 128, (l) => reports.push(l));
		observed[0].cb();
		const tall = content(400); // e.g. 3 lines with a big image: the old 500-char rule said "short"
		watchOverflow(tall, () => 128, (l) => reports.push(l));
		observed[1].cb();
		expect(reports).toEqual([false, true]);
	});

	it('follows size changes (images loading, window narrower) and disconnects on teardown', () => {
		let h = 100;
		const el = document.createElement('div');
		Object.defineProperty(el, 'offsetHeight', { get: () => h });
		const reports: boolean[] = [];
		const stop = watchOverflow(el, () => 128, (l) => reports.push(l));
		observed[0].cb();
		h = 300;
		observed[0].cb();
		expect(reports).toEqual([false, true]);
		stop();
		expect(observed[0].disconnected).toBe(true);
	});

	it('does nothing without ResizeObserver (the estimate stays)', () => {
		globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
		const report = vi.fn();
		const stop = watchOverflow(content(999), () => 128, report);
		stop();
		expect(report).not.toHaveBeenCalled();
	});

	it('remToPx uses the root font size', () => {
		document.documentElement.style.fontSize = '20px';
		expect(remToPx(8)).toBe(160);
		document.documentElement.style.fontSize = '';
		expect(remToPx(8)).toBe(128); // jsdom default 16px
	});
});
