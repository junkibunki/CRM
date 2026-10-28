import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

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
	// dev: forward API calls to the local PocketBase instance
	server: {
		proxy: { '/api': 'http://127.0.0.1:8090', '/_/': 'http://127.0.0.1:8090' }
	}
});
