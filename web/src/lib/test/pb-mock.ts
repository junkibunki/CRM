// In-memory stand-in for the PocketBase client, for unit tests of stores and sync logic.
// Usage in a test file:
//   vi.mock('../pb', async (orig) => {
//     const { createPbMock } = await import('../test/pb-mock');
//     const mock = createPbMock();
//     return { ...(await orig<typeof import('../pb')>()), pb: mock.pb, __mock: mock };
//   });
//   import * as pbModule from '../pb';
//   const mock = (pbModule as unknown as { __mock: PbMock }).__mock;
import { ClientResponseError } from 'pocketbase';

type Rec = { id: string; [key: string]: unknown };
type Event = { action: 'create' | 'update' | 'delete'; record: Rec };
type Sub = { topic: string; cb: (e: Event) => void };
type Method =
	| 'getFullList'
	| 'getOne'
	| 'getFirstListItem'
	| 'create'
	| 'update'
	| 'delete'
	| 'subscribe'
	| 'authRefresh'
	/** pb.createBatch().send(); hold/fail it on the collection name 'batch' */
	| 'batch';

export function apiError(status: number, message = 'error', data: Record<string, unknown> = {}) {
	return new ClientResponseError({ status, response: { status, message, data } });
}

/** Comparable timestamps in PocketBase format, strictly increasing. */
let tick = 0;
export function stamp() {
	tick++;
	return `2026-01-01 00:00:00.${String(tick).padStart(6, '0')}Z`;
}

export function createPbMock() {
	const db: Record<string, Rec[]> = {};
	const subs: Record<string, Sub[]> = {};
	const connectListeners: (() => void)[] = [];
	const failures: { collection?: string; method: Method; err: unknown }[] = [];
	const holds: { collection: string; method: Method; release: Promise<void> }[] = [];
	const calls: { collection: string; method: Method; args: unknown[] }[] = [];
	let nextId = 0;

	const clone = <T>(v: T): T => structuredClone(v);

	async function enter(collection: string, method: Method, args: unknown[]) {
		calls.push({ collection, method, args });
		const h = holds.findIndex((x) => x.collection === collection && x.method === method);
		if (h !== -1) {
			const [hold] = holds.splice(h, 1);
			await hold.release;
		}
		const f = failures.findIndex(
			(x) => x.method === method && (!x.collection || x.collection === collection)
		);
		if (f !== -1) {
			const [fail] = failures.splice(f, 1);
			throw fail.err;
		}
	}

	function collection(name: string) {
		const list = () => (db[name] ??= []);
		const find = (id: string) => {
			const rec = list().find((r) => r.id === id);
			if (!rec) throw apiError(404, "The requested resource wasn't found.");
			return rec;
		};
		return {
			// reads take their snapshot when the request starts, like a real query: a held
			// request (mock.hold) then returns stale data, which is what races are about
			async getFullList() {
				const snap = clone(list());
				await enter(name, 'getFullList', []);
				return snap;
			},
			async getOne(id: string) {
				const snap = clone(list().find((r) => r.id === id));
				await enter(name, 'getOne', [id]);
				if (!snap) throw apiError(404, "The requested resource wasn't found.");
				return snap;
			},
			async getFirstListItem() {
				const snapFirst = clone(list()[0]);
				await enter(name, 'getFirstListItem', []);
				const first = snapFirst;
				if (!first) throw apiError(404, "The requested resource wasn't found.");
				return clone(first);
			},
			async create(data: Record<string, unknown>) {
				await enter(name, 'create', [data]);
				const now = stamp();
				const rec: Rec = { id: `id${++nextId}`, created: now, updated: now, ...clone(data) };
				list().push(rec);
				return clone(rec);
			},
			async update(id: string, data: Record<string, unknown>) {
				await enter(name, 'update', [id, data]);
				const rec = find(id);
				Object.assign(rec, clone(data), { updated: stamp() });
				return clone(rec);
			},
			async delete(id: string) {
				await enter(name, 'delete', [id]);
				find(id);
				db[name] = list().filter((r) => r.id !== id);
				return true;
			},
			async subscribe(topic: string, cb: (e: Event) => void) {
				await enter(name, 'subscribe', [topic]);
				const sub = { topic, cb };
				(subs[name] ??= []).push(sub);
				return async () => {
					subs[name] = (subs[name] ?? []).filter((s) => s !== sub);
				};
			},
			async authRefresh() {
				await enter(name, 'authRefresh', []);
				return { token: pb.authStore.token, record: pb.authStore.record };
			}
		};
	}

	const authListeners: ((token: string, record: unknown) => void)[] = [];
	const authStore = {
		isValid: true,
		token: 'test-token',
		record: { id: 'u1', name: 'Test User', email: 'test@example.com' } as Rec | null,
		onChange(cb: (token: string, record: unknown) => void) {
			authListeners.push(cb);
			return () => {};
		},
		clear() {
			authStore.isValid = false;
			authStore.token = '';
			authStore.record = null;
			authListeners.forEach((cb) => cb('', null));
		}
	};

	/** batch API (only `update` is used): all requests in one transaction, all or nothing */
	function createBatch() {
		const requests: { collection: string; id: string; data: Record<string, unknown> }[] = [];
		return {
			collection(name: string) {
				return {
					update(id: string, data: Record<string, unknown>) {
						requests.push({ collection: name, id, data: clone(data) });
					}
				};
			},
			async send() {
				await enter('batch', 'batch', [clone(requests)]);
				const missing = requests.findIndex((r) => !(db[r.collection] ?? []).some((x) => x.id === r.id));
				if (missing !== -1) {
					throw apiError(400, 'Batch transaction failed.', {
						requests: { [missing]: { code: 'batch_request_failed', message: 'Batch request failed.' } }
					});
				}
				return requests.map((r) => {
					const rec = (db[r.collection] ?? []).find((x) => x.id === r.id)!;
					Object.assign(rec, clone(r.data), { updated: stamp() });
					return { status: 200, body: clone(rec) };
				});
			}
		};
	}

	const pb = {
		collection,
		createBatch,
		authStore,
		filter: (raw: string, params: Record<string, unknown> = {}) =>
			raw.replace(/\{:(\w+)\}/g, (_, k) => JSON.stringify(params[k])),
		realtime: {
			async subscribe(topic: string, cb: () => void) {
				if (topic === 'PB_CONNECT') connectListeners.push(cb);
				return async () => {
					const i = connectListeners.indexOf(cb);
					if (i !== -1) connectListeners.splice(i, 1);
				};
			}
		}
	};

	return {
		pb,
		db,
		calls,
		/** seed a collection */
		set(name: string, records: Rec[]) {
			db[name] = clone(records);
		},
		/** deliver a realtime event to all subscribers of a collection */
		emit(name: string, action: Event['action'], record: Rec) {
			for (const s of subs[name] ?? []) s.cb({ action, record: clone(record) });
		},
		subscriberCount(name: string) {
			return (subs[name] ?? []).length;
		},
		/** simulate the SSE connection coming back (PB_CONNECT) */
		reconnect() {
			connectListeners.forEach((cb) => cb());
		},
		/** make the next call of `method` (optionally on one collection) reject with `err` */
		fail(method: Method, err: unknown, collection?: string) {
			failures.push({ collection, method, err });
		},
		/** pause the next call of `method` on `collection` until the returned function runs */
		hold(collectionName: string, method: Method) {
			let release!: () => void;
			const p = new Promise<void>((r) => (release = r));
			holds.push({ collection: collectionName, method, release: p });
			return release;
		},
		/** clear failures, holds, subscriptions, connect listeners and calls (beforeEach) */
		reset() {
			failures.length = 0;
			holds.length = 0;
			calls.length = 0;
			connectListeners.length = 0;
			for (const k of Object.keys(subs)) delete subs[k];
			authStore.isValid = true;
			authStore.token = 'test-token';
			authStore.record = { id: 'u1', name: 'Test User', email: 'test@example.com' };
		},
		/** the session became invalid server-side: auth-refresh answers 401 */
		invalidateSession() {
			failures.push({ collection: 'users', method: 'authRefresh', err: apiError(401, 'invalid') });
		}
	};
}

export type PbMock = ReturnType<typeof createPbMock>;

/** let pending promise callbacks run */
export async function flush(times = 5) {
	for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
