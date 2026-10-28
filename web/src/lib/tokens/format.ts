// Pure helpers for the API token page (unit-tested in format.test.ts), in the browser's
// local time zone.

export type ApiToken = {
	id: string;
	user: string;
	name: string;
	/** '' = never used */
	last_used: string;
	created: string;
	updated: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = (pbDate: string) => new Date(pbDate.replace(' ', 'T'));

/** "nie", "gerade eben", "vor 5 Min.", "heute, 14:30", "gestern, 09:10", "28.10.2026" */
export function lastUsedText(lastUsed: string, now: Date): string {
	if (!lastUsed) return 'nie';
	const d = parse(lastUsed);
	if (Number.isNaN(d.getTime())) return 'nie';
	const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
	if (mins < 1) return 'gerade eben';
	if (mins < 60) return `vor ${mins} Min.`;
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 86_400_000);
	if (d >= today) return `heute, ${time(d)}`;
	if (d >= yesterday) return `gestern, ${time(d)}`;
	return day(d);
}

/** "28.10.2026" */
export function createdText(created: string): string {
	const d = parse(created);
	return Number.isNaN(d.getTime()) ? '' : day(d);
}

/** Newest first (ties: id), so a new token appears on top. */
export function byCreatedDesc(a: ApiToken, b: ApiToken): number {
	if (a.created !== b.created) return a.created < b.created ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The MCP endpoint: the reverse proxy serves it next to the app under /mcp. */
export function mcpUrl(origin: string): string {
	return `${origin.replace(/\/+$/, '')}/mcp`;
}

/** The command that registers the server in Claude Code. */
export function claudeCommand(url: string, token: string): string {
	return `claude mcp add --transport http crm ${url} --header "Authorization: Bearer ${token}"`;
}

/** The same as JSON (`.mcp.json` / other MCP clients). */
export function jsonConfig(url: string, token: string): string {
	return JSON.stringify(
		{ mcpServers: { crm: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
		null,
		2
	);
}
