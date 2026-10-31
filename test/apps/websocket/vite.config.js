import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import adapter from '../../../index.js';

export default defineConfig({
	build: { minify: false },
	plugins: [sveltekit({ adapter: adapter({ websocket: { idleTimeout: 60 } }) })]
});
