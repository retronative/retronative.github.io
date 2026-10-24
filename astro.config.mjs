// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The GitHub Pages organization site of retronative, served at the domain root.
// Project sites (e.g. /recarbon/) belong to their own repositories: this site
// never builds a route under a project's name (scripts/check-dist.mjs enforces it).
export default defineConfig({
	site: 'https://retronative.github.io',
	base: '/',
	trailingSlash: 'always',
	build: { format: 'directory' },
	integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
});
