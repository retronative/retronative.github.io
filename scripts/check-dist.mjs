// Checks the built site in dist/ (run after `astro build`). No dependencies.
// - No route under a project's id: /<id>/ belongs to that project's own Pages site.
// - Every page has a title, description, Open Graph and Twitter tags, and a canonical
//   URL (unless it is noindex); JSON-LD parses, and only / has it (Organization, WebSite).
// - Every internal link and #anchor resolves to a built file and an element id.
// - No link to a private target (a project link with public: false), to a GitHub
//   repository of the organization other than a project's public repo link, or to a
//   download; no `download` attribute.
// - The sitemap lists every indexable page, and robots.txt points at it.
// - /knowledge/ is built, its graph.json is the pinned file (sha256 of src/data/knowledge-graph.lock.json), its document
//   links go only to the knowledge base's blob/main/ prefix, and no page modulepreloads the lazy graph (Cytoscape) chunk.
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const SITE = 'https://retronative.github.io';
const ORG = 'https://github.com/retronative';
const projects = JSON.parse(await readFile(join(root, 'src/data/projects.json'), 'utf8'));

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(p)));
		else out.push(p);
	}
	return out;
}
const exists = (p) =>
	stat(p).then(
		(s) => s,
		() => null,
	);

// 1. Path collisions with project sites.
for (const p of projects) {
	if (await exists(join(dist, p.id))) fail(`dist/${p.id}/`, `top-level route under project id "${p.id}" (reserved for its own site)`);
}

// Private targets: every link of a project that is not public.
const privateUrls = projects.flatMap((p) => Object.values(p.links ?? {}).filter((l) => !l.public).map((l) => l.url.replace(/\/$/, '')));
// Public project links (a public repository may be linked; nothing else in the organization).
const publicUrls = projects.flatMap((p) => Object.values(p.links ?? {}).filter((l) => l.public).map((l) => l.url.replace(/\/$/, '')));
// The knowledge base: /knowledge/ links to its documents, and to nothing else in that repository.
const KB_DOCS = `${ORG}/game-port-knowledge/blob/main/`;

const files = await walk(dist);
const pages = files.filter((f) => f.endsWith('.html'));
const html = new Map(await Promise.all(pages.map(async (f) => [f, await readFile(f, 'utf8')])));
const idsOf = (src) => new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const attr = (src, re) => src.match(re)?.[1];

// Resolve "/a/b/#x" to the built file.
async function target(pathname) {
	const p = decodeURIComponent(pathname);
	const candidates = p.endsWith('/') ? [join(dist, p, 'index.html')] : [join(dist, p), join(dist, p, 'index.html'), join(dist, `${p}.html`)];
	for (const c of candidates) {
		const s = await exists(c);
		if (s?.isFile()) return c;
	}
	return null;
}

const indexable = [];
for (const [file, src] of html) {
	const name = relative(dist, file).split(sep).join('/');
	const noindex = /<meta name="robots" content="noindex"/.test(src);

	// 2. Head metadata.
	if (!attr(src, /<title>([^<]+)<\/title>/)) fail(name, 'missing <title>');
	if (!attr(src, /<meta name="description" content="([^"]+)"/)) fail(name, 'missing meta description');
	for (const prop of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'])
		if (!new RegExp(`<meta property="${prop}" content="[^"]+"`).test(src)) fail(name, `missing ${prop}`);
	for (const n of ['twitter:card', 'twitter:image'])
		if (!new RegExp(`<meta name="${n}" content="[^"]+"`).test(src)) fail(name, `missing ${n}`);
	if (!/<html lang="en"/.test(src)) fail(name, 'missing lang');
	if ((src.match(/<h1[\s>]/g) ?? []).length !== 1) fail(name, 'needs exactly one <h1>');
	const canonical = attr(src, /<link rel="canonical" href="([^"]+)"/);
	if (!noindex) {
		const expected = `${SITE}/${name.replace(/index\.html$/, '')}`;
		if (canonical !== expected) fail(name, `canonical ${canonical} != ${expected}`);
		indexable.push(expected);
	}
	const ogImage = attr(src, /<meta property="og:image" content="([^"]+)"/);
	if (ogImage && !(await exists(join(dist, new URL(ogImage).pathname)))) fail(name, `og:image ${ogImage} not built`);

	// JSON-LD.
	const blocks = [...src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	const types = [];
	for (const b of blocks) {
		try {
			const data = JSON.parse(b);
			if (data['@context'] !== 'https://schema.org') fail(name, 'JSON-LD without schema.org context');
			types.push(data['@type']);
		} catch (e) {
			fail(name, `invalid JSON-LD: ${e.message}`);
		}
	}
	const wantTypes = name === 'index.html' ? ['Organization', 'WebSite'] : [];
	if (types.sort().join() !== wantTypes.join()) fail(name, `JSON-LD types [${types}] != [${wantTypes}]`);

	// 3 and 4. Links.
	if (/\sdownload(=|\s|>)/.test(src)) fail(name, 'has a download attribute');
	for (const [, raw] of src.matchAll(/\shref="([^"]*)"/g)) {
		const href = raw.replace(/&amp;/g, '&');
		if (/^(mailto:|tel:)/.test(href)) continue;
		if (/^https?:\/\//.test(href)) {
			const u = href.replace(/\/$/, '');
			if (privateUrls.some((p) => u === p || u.startsWith(`${p}/`) || u.startsWith(`${p}#`))) fail(name, `links to a private target: ${href}`);
			if (u.startsWith(`${ORG}/`) && !publicUrls.some((p) => u === p) && !(name === 'knowledge/index.html' && u.startsWith(KB_DOCS) && u.length > KB_DOCS.length)) fail(name, `links into the organization (only ${ORG} itself is allowed): ${href}`);
			if (/\/releases(\/|$)|\.(dmg|zip|pkg|app|exe|iso|xex)(\?|#|$)/i.test(u)) fail(name, `download-like link: ${href}`);
			continue;
		}
		const url = new URL(href, `${SITE}/${name}`);
		if (url.origin !== SITE) continue;
		if (/\.(dmg|zip|pkg|exe|iso|xex)$/i.test(url.pathname)) fail(name, `download-like link: ${href}`);
		const to = await target(url.pathname);
		if (!to) {
			fail(name, `broken link ${href}`);
			continue;
		}
		if (url.hash && to.endsWith('.html')) {
			const id = decodeURIComponent(url.hash.slice(1));
			if (!idsOf(html.get(to) ?? '').has(id)) fail(name, `missing anchor ${href}`);
		}
	}

	// 6. The lazy graph chunk is never preloaded.
	for (const [, tag] of src.matchAll(/(<link[^>]*rel="modulepreload"[^>]*>)/g)) if (/knowledge-graph-view|cytoscape/.test(tag)) fail(name, `modulepreloads the graph chunk: ${tag}`);
}

// 7. /knowledge/ and its graph.
const lock = JSON.parse(await readFile(join(root, 'src/data/knowledge-graph.lock.json'), 'utf8'));
if (!html.has(join(dist, 'knowledge/index.html'))) fail('knowledge/index.html', 'missing');
const graphFile = join(dist, 'knowledge/graph.json');
if (!(await exists(graphFile))) fail('knowledge/graph.json', 'missing');
else {
	const sum = createHash('sha256').update(await readFile(graphFile)).digest('hex');
	if (sum !== lock.sha256) fail('knowledge/graph.json', `sha256 ${sum} != lock ${lock.sha256}`);
}
if (/["']\/knowledge\/graph\.json/.test(html.get(join(dist, 'index.html')) ?? '')) fail('index.html', 'references /knowledge/graph.json');

// 5. Sitemap and robots.
const sitemap = (await exists(join(dist, 'sitemap-0.xml'))) ? await readFile(join(dist, 'sitemap-0.xml'), 'utf8') : '';
if (!(await exists(join(dist, 'sitemap-index.xml')))) fail('sitemap-index.xml', 'missing');
const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
for (const url of indexable) if (!listed.has(url)) fail('sitemap-0.xml', `missing ${url}`);
for (const url of listed) if (!indexable.includes(url)) fail('sitemap-0.xml', `lists ${url}, which is not an indexable page`);
const robots = (await exists(join(dist, 'robots.txt'))) ? await readFile(join(dist, 'robots.txt'), 'utf8') : '';
if (!robots.includes(`Sitemap: ${SITE}/sitemap-index.xml`)) fail('robots.txt', 'missing Sitemap line');

if (errors.length) {
	console.error(`check-dist: ${errors.length} problem(s)\n${errors.map((e) => `  - ${e}`).join('\n')}`);
	process.exit(1);
}
console.log(`check-dist: ${pages.length} pages, ${indexable.length} in the sitemap, all checks passed`);
