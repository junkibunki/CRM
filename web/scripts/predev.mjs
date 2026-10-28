// Runs the unit tests before `npm run dev` and prints a clear verdict, so you see on start
// whether everything still works. The dev server starts either way (you want to fix it).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// vitest directly, not via npx: npx alone adds ~25 s on Windows
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const res = spawnSync(process.execPath, [vitest, 'run', '--reporter=dot'], { stdio: 'inherit' });

const line = '='.repeat(64);
if (res.status === 0) {
	console.log(`\n\x1b[32m${line}\n  Unit-Tests grün – alles funktioniert wie erwartet.\n${line}\x1b[0m\n`);
} else {
	console.log(
		`\n\x1b[31m${line}\n  ACHTUNG: Unit-Tests rot (siehe oben). Dev-Server startet trotzdem.\n${line}\x1b[0m\n`
	);
}
process.exit(0);
