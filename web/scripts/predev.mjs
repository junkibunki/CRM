// Runs the unit tests before `npm run dev` and prints a clear verdict, so you see on start
// whether everything still works. The dev server starts either way (you want to fix it).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// vitest directly, not via npx: npx alone adds ~25 s on Windows
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const web = spawnSync(process.execPath, [vitest, 'run', '--reporter=dot'], { stdio: 'inherit' });

// MCP service: unit tests only (the end-to-end test needs the PocketBase binary, see test:mcp)
const mcpDir = fileURLToPath(new URL('../../mcp/', import.meta.url));
let mcp = null;
if (existsSync(mcpDir + 'node_modules')) {
	mcp = spawnSync(process.execPath, ['--test', '--test-reporter=dot', 'src/**/*.test.js'], {
		cwd: mcpDir,
		stdio: 'inherit'
	});
}

const line = '='.repeat(64);
const mcpNote = mcp ? '' : '\n  (MCP-Dienst nicht geprüft: einmalig `cd mcp && npm ci`)';
if (web.status === 0 && (!mcp || mcp.status === 0)) {
	console.log(
		`\n\x1b[32m${line}\n  Unit-Tests grün – alles funktioniert wie erwartet.${mcpNote}\n${line}\x1b[0m\n`
	);
} else {
	const state = (r) => (r.status === 0 ? 'grün' : 'ROT');
	const detail = `Web: ${state(web)}` + (mcp ? `, MCP: ${state(mcp)}` : '');
	console.log(
		`\n\x1b[31m${line}\n  ACHTUNG: Unit-Tests rot (${detail}, siehe oben).${mcpNote}\n  Dev-Server startet trotzdem.\n${line}\x1b[0m\n`
	);
}
process.exit(0);
