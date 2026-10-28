import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const PB_URL = process.env.PB_URL ?? 'http://127.0.0.1:8090';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SPA build, served by PocketBase from pb_public/
			adapter: adapter({ pages: '../pocketbase/pb_public', fallback: 'index.html' })
		})
	],
	// tiptap is loaded lazily by the activity form; pre-bundle it so the first open of the form
	// doesn't make Vite re-optimise and reload the page
	optimizeDeps: {
		include: ['@tiptap/core', '@tiptap/starter-kit']
	},
	// dev: forward API calls to the local PocketBase instance (PB_URL: parallel agent envs)
	server: {
		proxy: { '/api': PB_URL, '/_/': PB_URL }
	},
	// runes ($state/$derived) only react in the client build, hence browser conditions + jsdom
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		restoreMocks: true
	}
});
