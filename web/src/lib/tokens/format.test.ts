import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.TZ = 'Europe/Berlin';
});

import { byCreatedDesc, claudeCommand, createdText, jsonConfig, lastUsedText, mcpUrl, type ApiToken } from './format';

const now = new Date('2026-10-28T12:00:00Z'); // 13:00 in Berlin

describe('lastUsedText', () => {
	it('never used', () => {
		expect(lastUsedText('', now)).toBe('nie');
		expect(lastUsedText('kaputt', now)).toBe('nie');
	});

	it('relative for the last hour, then today / yesterday / the date', () => {
		expect(lastUsedText('2026-10-28 11:59:40.000Z', now)).toBe('gerade eben');
		expect(lastUsedText('2026-10-28 11:55:00.000Z', now)).toBe('vor 5 Min.');
		expect(lastUsedText('2026-10-28 07:15:00.000Z', now)).toBe('heute, 08:15');
		// 23:30 UTC on the 26th is already the 27th in Berlin: yesterday
		expect(lastUsedText('2026-10-26 23:30:00.000Z', now)).toBe('gestern, 00:30');
		expect(lastUsedText('2026-10-26 12:00:00.000Z', now)).toBe('26.10.2026');
	});
});

describe('the rest', () => {
	it('created date', () => {
		expect(createdText('2026-10-01 10:00:00.000Z')).toBe('01.10.2026');
		expect(createdText('')).toBe('');
	});

	it('sorts newest first', () => {
		const t = (id: string, created: string) => ({ id, created }) as ApiToken;
		const list = [t('a', '2026-01-01'), t('c', '2026-03-01'), t('b', '2026-03-01')];
		expect(list.sort(byCreatedDesc).map((x) => x.id)).toEqual(['c', 'b', 'a']);
	});

	it('MCP url and client configuration', () => {
		expect(mcpUrl('https://crm.example.de/')).toBe('https://crm.example.de/mcp');
		expect(claudeCommand('https://crm.x/mcp', 'crm_abc')).toBe(
			'claude mcp add --transport http crm https://crm.x/mcp --header "Authorization: Bearer crm_abc"'
		);
		expect(JSON.parse(jsonConfig('https://crm.x/mcp', 'crm_abc'))).toEqual({
			mcpServers: { crm: { type: 'http', url: 'https://crm.x/mcp', headers: { Authorization: 'Bearer crm_abc' } } }
		});
	});
});
