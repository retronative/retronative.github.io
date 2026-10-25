// Behaviour tests for /knowledge/ against a running preview (npm run preview).
//   node scripts/knowledge-test.mjs [base-url] [screenshot-dir]      default http://127.0.0.1:4400
// No-JS list (symptoms, techniques and guides, investigations, projects; commit hashes only in Evidence disclosures) and
// search form, in-page filtering, the lazy graph (loaded only on demand, never on /), the concept-only default view and
// Advanced mode (#advanced), selection, keyboard use, the relation vocabulary, label overlap at fit zoom, zoom without
// animation under reduced motion, axe with the graph open.
// The graph's Cytoscape instance is read from its container (container._cyreg.cy, Cytoscape 3.34.4); the page
// exposes no test hook. Needs a Playwright Chromium; axe-core 4.10.2 is loaded from cdnjs.
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? 'http://127.0.0.1:4400').replace(/\/$/, '');
const shots = process.argv[3];
const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const graph = JSON.parse(await readFile(new URL('../src/data/knowledge-graph.json', import.meta.url), 'utf8'));
const docs = graph.nodes.filter((n) => n.kind === 'guide' || n.kind === 'investigation');
const techniques = graph.nodes.filter((n) => n.kind === 'technique');
const commits = graph.nodes.filter((n) => n.kind === 'commit');
const primary = graph.nodes.filter((n) => !n.advanced);
const inferredCount = graph.inferred_edges.length;
// The fixed relation vocabulary (knowledge base config.json) and the causal words shared evidence must never use.
const VOCABULARY = [
	'documents', 'is documented in', 'documents the symptom', 'is investigated in', 'investigates the symptom', 'references', 'is referenced by',
	'draws on evidence from', 'provides evidence for', 'cites the same evidence as', 'cites commit', 'is cited by', 'is a commit of', 'has commit',
	'is related to', 'follows the same pattern as',
];
const CAUSAL = /\b(?:caused|causes|because of|fixes|leads to)\b/i;
const HASHES = new RegExp(`\\b(?:${commits.map((c) => c.id.split(':')[2]).join('|')})\\b`);
const CY = "document.querySelector('[data-kg-canvas]')._cyreg.cy";
const isGraphAsset = (u) => /\/knowledge\/graph\.json|knowledge-graph-view|cytoscape/.test(u);

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures++;
};

const browser = await chromium.launch();
async function open(path, opts = {}) {
	const context = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 900 }, javaScriptEnabled: opts.js ?? true, reducedMotion: opts.reducedMotion ?? 'no-preference' });
	const page = await context.newPage();
	const errors = [];
	const requests = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('request', (r) => requests.push(r.url()));
	await page.goto(`${base}${path}`, { waitUntil: 'load' });
	return { context, page, errors, requests };
}
const openGraph = async (page) => {
	await page.click('[data-kg-open]');
	await page.waitForSelector('[data-kb-graph][data-state="ready"]', { timeout: 15000 });
};
const axe = async (page) => {
	await page.addScriptTag({ url: AXE });
	return page.evaluate(async () => {
		const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] });
		return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
	});
};
const allErrors = [];
// Visible node labels (non-empty and at a legible zoomed size) and how many pairs of their boxes overlap.
const labelStats = (cyExpr) => {
	const cy = eval(cyExpr);
	const z = cy.zoom();
	const shown = cy.nodes().filter((n) => n.style('display') !== 'none' && n.pstyle('label').strValue !== '' && parseFloat(n.style('font-size')) * z >= parseFloat(n.style('min-zoomed-font-size')));
	const boxes = shown.map((n) => n.boundingBox({ includeLabels: true, includeOverlays: false }));
	let overlaps = 0;
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const [A, B] = [boxes[i], boxes[j]];
			if (A.x1 < B.x2 && B.x1 < A.x2 && A.y1 < B.y2 && B.y1 < A.y2) overlaps++;
		}
	return { zoom: z, shown: shown.length, overlaps };
};

try {
	// (a) No JavaScript.
	{
		const { context, page, errors, requests } = await open('/knowledge/', { js: false });
		const sections = await page.$$eval('main section[id] > h2', (hs) => hs.map((h) => [h.parentElement.id, h.textContent.trim()]));
		check(
			'no-JS: the four sections in order (symptoms, techniques and guides, investigations, projects)',
			JSON.stringify(sections.slice(0, 4)) === JSON.stringify([['symptoms', 'Start from a symptom'], ['guides', 'Techniques and guides'], ['investigations', 'Investigations'], ['projects', 'Projects']]),
			JSON.stringify(sections),
		);
		const cards = await page.$$eval('#guides [data-kb-item], #investigations [data-kb-item]', (els) => els.map((e) => e.id));
		check('no-JS: every guide and investigation is listed', cards.length === docs.length, `${cards.length}/${docs.length}`);
		const hrefs = await page.$$eval('#guides a, #investigations a', (as) => as.map((a) => a.href));
		check('no-JS: every guide and investigation has its documentation link', docs.every((d) => hrefs.includes(d.href)), `${hrefs.length} links`);
		check('no-JS: every technique links to its section anchor', techniques.every((t) => hrefs.includes(t.href)), `${techniques.filter((t) => hrefs.includes(t.href)).length}/${techniques.length}`);
		const badges = await page.$$eval('.techniques .status-tag', (b) => b.map((x) => x.textContent.trim()));
		check('no-JS: technique status badges are text', badges.length === techniques.filter((t) => t.status).length && badges.every((b) => /^[A-Za-z]+$/.test(b)), badges.join(','));
		const symptoms = await page.$$eval('#symptoms [data-kb-item]', (els) => els.length);
		check('no-JS: symptoms listed', symptoms === graph.nodes.filter((n) => n.kind === 'symptom').length, `${symptoms}`);
		const leads = await page.$$eval('#symptoms .leads li', (els) => els.map((e) => e.textContent.trim().split(' ').slice(0, 2).join(' ')));
		check('no-JS: symptoms say "Documented in" or "Investigated in"', leads.length > 0 && leads.every((l) => l === 'Documented in' || l === 'Investigated in'), [...new Set(leads)].join(', '));
		const projects = await page.$$eval('#projects [data-kb-item]', (els) => els.length);
		check('no-JS: projects listed', projects === graph.nodes.filter((n) => n.kind === 'project').length, `${projects}`);
		const evidence = await page.$$eval('[data-kb-item]', (items) => items.map((i) => ({ id: i.id, n: i.querySelectorAll(':scope details[data-kb-evidence]').length, open: [...i.querySelectorAll('details')].some((d) => d.open) })));
		check('no-JS: every item has a closed Evidence disclosure', evidence.every((e) => e.n > 0 && !e.open), evidence.filter((e) => !e.n || e.open).map((e) => e.id).join(', '));
		const outside = await page.evaluate(() => {
			const main = document.querySelector('main').cloneNode(true);
			main.querySelectorAll('details[data-kb-evidence]').forEach((d) => d.remove());
			return main.textContent;
		});
		const inside = await page.$$eval('details[data-kb-evidence]', (ds) => ds.map((d) => d.textContent).join(' '));
		check('no-JS: commit hashes appear only inside Evidence disclosures', !HASHES.test(outside) && HASHES.test(inside), outside.match(HASHES)?.[0] ?? '');
		const derived = await page.$$eval('.shared, [data-kb-legend-derived]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
		check('no-JS: shared-evidence wording is never causal', derived.length > 0 && derived.every((t) => !CAUSAL.test(t)), derived.find((t) => CAUSAL.test(t)) ?? `${derived.length} texts`);
		const form = await page.$eval('form[role="search"]', (f) => ({ action: f.action, method: f.method, q: !!f.querySelector('input[name="q"]'), type: f.querySelector('input[name="type"]')?.value }));
		check('no-JS: search form posts to GitHub code search', form.action === 'https://github.com/retronative/knowledge/search' && form.method === 'get' && form.q && form.type === 'code', JSON.stringify(form));
		const graphHidden = await page.$eval('[data-kb-graph]', (s) => s.hidden && getComputedStyle(s).display === 'none');
		const jsButtons = await page.$$eval('[data-show-node]', (bs) => bs.filter((b) => b.offsetParent !== null).length);
		check('no-JS: graph section and Show-in-graph buttons are hidden', graphHidden && jsButtons === 0, `visible buttons ${jsButtons}`);
		if (inferredCount) {
			const inferredHidden = await page.$$eval('.inferred', (els) => els.every((e) => getComputedStyle(e).display === 'none'));
			await page.check('#show-inferred');
			const inferredShown = await page.$$eval('.inferred', (els) => els.length > 0 && els.every((e) => getComputedStyle(e).display !== 'none'));
			check('no-JS: inferred hidden by default, CSS checkbox shows them', inferredHidden && inferredShown);
		} else {
			const none = await page.evaluate(() => !document.querySelector('#show-inferred, .inferred, [data-kg-inferred-mirror]') && !!document.querySelector('.toggle-none'));
			check('no-JS: no inferred edges, so no inferred toggle or items, and the legend says so', none);
		}
		check('no-JS: no graph assets requested', !requests.some(isGraphAsset));
		check('no-JS: no console errors', errors.length === 0, errors.join(' | '));
		await context.close();
	}

	// (b) JavaScript on.
	{
		const { context, page, errors, requests } = await open('/knowledge/');
		check('JS: initial render fetches no graph assets', !requests.some(isGraphAsset), requests.filter(isGraphAsset).join(', '));
		const total = await page.$$eval('[data-kb-item]', (els) => els.length);
		await page.fill('#kb-q', 'waveout');
		const visible = await page.$$eval('[data-kb-item]', (els) => els.filter((e) => !e.hidden).map((e) => e.id));
		check('JS: search filters the list in place', visible.length > 0 && visible.length < total && visible.includes('kg-win32-waveout-on-sdl-audio-md'), `${visible.length}/${total}: ${visible.join(', ')}`);
		await page.press('#kb-q', 'Enter');
		check('JS: submitting does not leave the page', page.url().startsWith(base));
		await page.waitForTimeout(400);
		const status = await page.textContent('[data-kb-status]');
		check('JS: status announces the match count', /\d+ of \d+ items match/.test(status ?? ''), status);
		await page.fill('#kb-q', '');
		const after = await page.$$eval('[data-kb-item]', (els) => els.filter((e) => !e.hidden).length);
		check('JS: clearing the search restores the list', after === total);

		if (inferredCount) {
			const inferredOff = await page.$$eval('.inferred', (els) => els.every((e) => !e.checkVisibility()));
			check('JS: inferred toggle off by default', !(await page.isChecked('#show-inferred')) && inferredOff);
			await page.check('#show-inferred');
			const inferredOn = await page.$$eval('.inferred', (els) => els.every((e) => e.checkVisibility()));
			const rationale = await page.$$eval('.inferred .why', (els) => els.map((e) => e.textContent.trim()));
			check('JS: toggling shows inferred items with their rationale', inferredOn && rationale.length > 0 && rationale.every((r) => r.startsWith('Rationale:')), `${rationale.length} rationale(s)`);
			await page.uncheck('#show-inferred');
		}

		await openGraph(page);
		const canvases = await page.$$eval('[data-kg-canvas] canvas', (c) => c.length);
		const loaded = await page.textContent('[data-kg-loading]');
		check('JS: graph canvas present after opening', canvases > 0, `${canvases} canvas elements`);
		check('JS: graph shows the primary nodes', loaded === `Graph loaded: ${primary.length} nodes shown.`, loaded);
		const view = await page.evaluate(`(() => { const cy = ${CY}; const shown = cy.nodes().filter((n) => n.style('display') !== 'none'); return { kinds: [...new Set(shown.map((n) => n.data('kind')))].sort(), commits: shown.filter((n) => n.data('kind') === 'commit').length, total: shown.length, adv: document.querySelector('[data-kg-advanced]').checked, hash: location.hash, jump: [...document.querySelectorAll('[data-kg-jump] optgroup')].map((g) => g.label) }; })()`);
		check(
			'JS: default view shows symptoms, guides, investigations, techniques and projects, no commits; jump list without commits',
			view.commits === 0 && view.total === primary.length && view.kinds.join() === 'guide,investigation,project,symptom,technique' && !view.adv && view.hash === '' && !view.jump.includes('commits'),
			JSON.stringify(view),
		);
		const labels = await page.evaluate(`${CY}.edges().map((e) => e.data('relation'))`);
		const edgeLabels = graph.edges.concat(graph.inferred_edges).flatMap((e) => [e.label, e.inverse]);
		check('JS: every relation label comes from the fixed vocabulary', labels.length > 0 && edgeLabels.every((l) => VOCABULARY.includes(l)), edgeLabels.filter((l) => !VOCABULARY.includes(l)).join(', '));
		check('JS: graph assets fetched only after opening', requests.some((u) => u.endsWith('/knowledge/graph.json')) && requests.some((u) => u.includes('knowledge-graph-view')));

		const target = 'win32/loader-and-imports.md';
		await page.click(`[data-show-node="${target}"]`);
		await page.waitForFunction(() => document.querySelector('[data-kg-live]')?.textContent?.startsWith('Selected'));
		const live = await page.textContent('[data-kg-live]');
		const label = docs.find((d) => d.id === target).label;
		check('JS: Show in graph selects the node and updates aria-live', live?.includes(label), live);
		const focused = await page.evaluate(() => document.activeElement?.className);
		check('JS: focus moves to the details heading', focused?.includes('kg-d-title'), focused);
		const docLink = await page.$eval('[data-kg-details] a', (a) => a.href).catch(() => null);
		check('JS: details panel has the documentation link', docLink === docs.find((d) => d.id === target).href, docLink);
		const inferredBefore = await page.$$eval('[data-kg-details] .is-inferred', (e) => e.length);
		if (inferredCount) {
			await page.check('#show-inferred');
			const inferredAfter = await page.$$eval('[data-kg-details] .is-inferred', (e) => e.length);
			const mirrored = await page.isChecked('[data-kg-inferred-mirror]');
			const tag = await page.$eval('[data-kg-details] .is-inferred .tag', (e) => e.textContent).catch(() => null);
			check('JS: inferred edges hidden in graph by default, shown (labelled INFERRED) when toggled', inferredBefore === 0 && inferredAfter >= 0 && mirrored && (inferredAfter === 0 || tag === 'INFERRED'), `${inferredBefore} -> ${inferredAfter}, tag ${tag}`);
		} else {
			const graphInferred = await page.evaluate(`${CY}.edges('[confidence = "INFERRED"]').length`);
			check('JS: no inferred edges in the graph or the details panel', inferredBefore === 0 && graphInferred === 0, `${graphInferred} in graph`);
		}
		const rels = await page.$$eval('[data-kg-details] .kg-d-rel', (els) => els.map((e) => e.textContent.trim()));
		check(
			'JS: details relations use the vocabulary; no file:line evidence outside Advanced mode',
			rels.length > 0 && rels.every((r) => VOCABULARY.includes(r) || /^cites the same evidence \(commit [0-9a-f, ]+\) as$/.test(r)) && !(await page.$('[data-kg-details] .kg-d-ev')),
			rels.join(' | '),
		);
		await page.keyboard.press('Escape');
		check('JS: Escape clears the selection', (await page.textContent('[data-kg-live]')) === 'Selection cleared.');

		// Shared evidence in the details panel: labelled DERIVED, never causal.
		const shared = graph.edges.find((e) => e.relation === 'shares_evidence');
		await page.selectOption('[data-kg-jump]', shared.source);
		const derived = await page.$$eval('[data-kg-details] .is-derived', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
		check('JS: shared evidence in the details is DERIVED and never causal', derived.length > 0 && derived.every((t) => t.includes('cites the same evidence (commit') && t.endsWith('DERIVED') && !CAUSAL.test(t)), derived.join(' | '));

		// The details panel shows the full title; the graph uses the short label.
		const tech = techniques.find((t) => t.short.endsWith('…'));
		await page.selectOption('[data-kg-jump]', tech.id);
		const shown = await page.evaluate(`({ graph: ${CY}.getElementById(${JSON.stringify(tech.id)}).pstyle('label').strValue, heading: document.querySelector('[data-kg-details] .kg-d-title').textContent })`);
		check('JS: the graph shows the short label, the details panel the full title', shown.graph === tech.short && shown.heading === tech.label && tech.label.length > tech.short.length, JSON.stringify(shown));
		await page.keyboard.press('Escape');

		// Advanced mode: a real checkbox, reflected in the URL hash.
		await page.check('[data-kg-advanced]');
		const adv = await page.evaluate(`(() => { const cy = ${CY}; return { commits: cy.nodes('[kind = "commit"]').filter((n) => n.style('display') !== 'none').length, cites: cy.edges('[relation = "cites"]').filter((e) => e.style('display') !== 'none').length, hash: location.hash, jump: [...document.querySelectorAll('[data-kg-jump] optgroup')].map((g) => g.label), legend: !document.querySelector('[data-kg-legend-commit]').hidden, live: document.querySelector('[data-kg-live]').textContent }; })()`);
		check('advanced: shows the commits and cites edges, sets #advanced, lists commits, shows the legend entry', adv.commits === commits.length && adv.cites > 0 && adv.hash === '#advanced' && adv.jump.includes('commits') && adv.legend && adv.live.startsWith('Advanced mode on'), JSON.stringify(adv));
		await page.selectOption('[data-kg-jump]', 'recarbon/m6-render-queue-fences.md');
		const ev = await page.$$eval('[data-kg-details] .kg-d-ev', (els) => els.map((e) => e.textContent));
		check('advanced: the details panel shows file:line evidence', ev.length > 0 && ev.every((t) => /^Evidence: [\w./-]+\.md:\d+/.test(t)), ev.slice(0, 2).join(' | '));
		await page.keyboard.press('Escape');
		await page.uncheck('[data-kg-advanced]');
		const off = await page.evaluate(`({ commits: ${CY}.nodes('[kind = "commit"]').filter((n) => n.style('display') !== 'none').length, hash: location.hash })`);
		check('advanced: unchecking hides the commits and clears the hash', off.commits === 0 && off.hash === '', JSON.stringify(off));

		await page.selectOption('[data-kg-project]', 'project:refrozen');
		await page.click('[data-kg-fit]');
		await page.click('[data-kg-zoom-in]');
		await page.click('[data-kg-zoom-out]');
		check('JS: filters and zoom controls run without errors', errors.length === 0, errors.join(' | '));
		await page.selectOption('[data-kg-project]', '');
		await page.fill('#kb-q', 'audio');
		check('JS: search with graph open still filters', (await page.$$eval('[data-kb-item]', (els) => els.filter((e) => !e.hidden).length)) < total);
		const hl = await page.evaluate(`(() => { const cy = ${CY}; return { match: cy.nodes('.match').length, faded: cy.nodes('.faded').length }; })()`);
		check('JS: search highlights matching graph nodes', hl.match > 0 && hl.faded > 0, JSON.stringify(hl));
		allErrors.push(...errors);
		await context.close();
	}

	// (b) A shared #advanced link opens the graph in Advanced mode.
	{
		const { context, page, errors, requests } = await open('/knowledge/#advanced', { width: 1280 });
		await page.waitForSelector('[data-kb-graph][data-state="ready"]', { timeout: 15000 });
		const r = await page.evaluate(`({ checked: document.querySelector('[data-kg-advanced]').checked, commits: ${CY}.nodes('[kind = "commit"]').filter((n) => n.style('display') !== 'none').length })`);
		check('advanced: /knowledge/#advanced opens the graph with commits shown', r.checked && r.commits === commits.length && requests.some((u) => u.endsWith('/knowledge/graph.json')), JSON.stringify(r));
		allErrors.push(...errors);
		await context.close();
	}

	// (b) Keyboard only: Tab to the open button, Enter, Tab to the node list, choose a node.
	{
		const { context, page, errors } = await open('/knowledge/');
		const tabTo = async (selector, max = 400) => {
			for (let i = 0; i < max; i++) {
				await page.keyboard.press('Tab');
				if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return true;
			}
			return false;
		};
		const reachedOpen = await tabTo('[data-kg-open]');
		await page.keyboard.press('Enter');
		await page.waitForSelector('[data-kb-graph][data-state="ready"]', { timeout: 15000 });
		// Back up (Shift+Tab) to the nearest "Show in graph" button and press Enter.
		let reachedShow = false;
		for (let i = 0; i < 40 && !reachedShow; i++) {
			await page.keyboard.press('Shift+Tab');
			reachedShow = await page.evaluate(() => !!document.activeElement?.matches('[data-show-node]'));
		}
		const wanted = await page.evaluate(() => document.activeElement?.getAttribute('data-show-node'));
		await page.keyboard.press('Enter');
		await page.waitForFunction(() => document.querySelector('[data-kg-live]')?.textContent?.startsWith('Selected'), null, { timeout: 5000 }).catch(() => {});
		const live = await page.textContent('[data-kg-live]');
		const wantedLabel = graph.nodes.find((n) => n.id === wanted)?.label;
		check('keyboard: open graph and select a node without a mouse (Tab, Enter, Shift+Tab, Enter)', reachedOpen && reachedShow && !!wantedLabel && live?.includes(wantedLabel), live);
		await page.keyboard.press('Escape');
		// The in-graph node list: focus it by Tab, then type-ahead (a closed select picks the option as you type).
		const reachedJump = await tabTo('[data-kg-jump]', 400);
		await page.keyboard.type(docs[0].label.slice(0, 8));
		await page.waitForFunction(() => document.querySelector('[data-kg-live]')?.textContent?.startsWith('Selected'), null, { timeout: 5000 }).catch(() => {});
		const live2 = await page.textContent('[data-kg-live]');
		check('keyboard: node list in the graph selects a node', reachedJump && live2?.includes(docs[0].label), live2);
		await page.keyboard.press('Escape');
		const reachedAdvanced = await tabTo('[data-kg-advanced]', 40);
		await page.keyboard.press('Space');
		const advOn = await page.evaluate(`({ checked: document.querySelector('[data-kg-advanced]').checked, hash: location.hash, commits: ${CY}.nodes('[kind = "commit"]').filter((n) => n.style('display') !== 'none').length })`);
		await page.keyboard.press('Space');
		check('keyboard: Advanced mode toggles with Tab and Space', reachedAdvanced && advOn.checked && advOn.hash === '#advanced' && advOn.commits === commits.length && !(await page.isChecked('[data-kg-advanced]')), JSON.stringify(advOn));
		await page.evaluate(() => document.querySelector('[data-kg-open]').focus());
		// Every graph control is a Tab stop with a visible focus indicator.
		const stops = [];
		for (let i = 0; i < 30; i++) {
			await page.keyboard.press('Tab');
			const info = await page.evaluate(() => {
				const el = document.activeElement;
				if (!el || !el.closest('#graph')) return null;
				const cs = getComputedStyle(el);
				return { name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName, ok: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none' };
			});
			if (!info) break;
			stops.push(info);
		}
		check('keyboard: graph controls have visible focus', stops.length >= 8 && stops.every((s) => s.ok), stops.map((s) => `${s.name}${s.ok ? '' : ' (no indicator)'}`).join(', '));
		allErrors.push(...errors);
		await context.close();
	}

	// (c) Reduced motion.
	{
		const { context, page, errors } = await open('/knowledge/', { reducedMotion: 'reduce' });
		await openGraph(page);
		await page.click('[data-show-node="general/static-recompilation.md"]');
		await page.click('[data-kg-zoom-in]');
		const motion = await page.evaluate(() => {
			const dur = (v) => v.split(',').some((d) => parseFloat(d) > 0);
			const timed = [...document.querySelectorAll('*')].filter((el) => {
				const cs = getComputedStyle(el);
				return dur(cs.transitionDuration) || (cs.animationName !== 'none' && dur(cs.animationDuration));
			});
			return { animations: document.getAnimations().length, timed: timed.length, scroll: getComputedStyle(document.documentElement).scrollBehavior };
		});
		check('reduced motion: no animations or timed transitions with the graph open', motion.animations === 0 && motion.timed === 0 && motion.scroll === 'auto', JSON.stringify(motion));
		allErrors.push(...errors);
		await context.close();
	}

	// (c2) Zoom on selection: synchronous under reduced motion, animated otherwise. Read in the same task as
	// select() (a MutationObserver on the live region, which select() updates after it zooms), then after two
	// frames, then after the 200 ms animation would have ended.
	const selectionTiming = async (reducedMotion) => {
		const { context, page, errors } = await open('/knowledge/', { reducedMotion });
		await openGraph(page);
		const r = await page.evaluate(
			({ id, cyExpr }) =>
				new Promise((resolve) => {
					const cy = eval(cyExpr);
					const node = cy.getElementById(id);
					const before = cy.zoom();
					const target = Math.max(before, 1);
					// cy.center() centres the node's bounding box (label included).
					const offset = () => {
						const bb = node.renderedBoundingBox();
						return Math.hypot((bb.x1 + bb.x2) / 2 - cy.width() / 2, (bb.y1 + bb.y2) / 2 - cy.height() / 2);
					};
					const live = document.querySelector('[data-kg-live]');
					const read = () => ({ zoom: cy.zoom(), offset: offset(), animated: cy.animated() });
					new MutationObserver((_, observer) => {
						if (!live.textContent.startsWith('Selected')) return;
						observer.disconnect();
						const now = read();
						requestAnimationFrame(() =>
							requestAnimationFrame(() => {
								const frames = read();
								setTimeout(() => resolve({ before, target, now, frames, end: read() }), 600);
							}),
						);
					}).observe(live, { childList: true, characterData: true, subtree: true });
					document.querySelector(`[data-show-node="${id}"]`).click();
				}),
			{ id: 'general/static-recompilation.md', cyExpr: CY },
		);
		allErrors.push(...errors);
		await context.close();
		return r;
	};
	{
		const r = await selectionTiming('reduce');
		const at = (v) => Math.abs(v.zoom - r.target) < 1e-9;
		check(
			'reduced motion: Show in graph zooms and centres synchronously, no Cytoscape animation',
			r.before < r.target && at(r.now) && r.now.offset < 1 && !r.now.animated && at(r.frames) && !r.frames.animated && at(r.end),
			JSON.stringify(r),
		);
		const a = await selectionTiming('no-preference');
		check(
			'no motion preference: the same selection animates (not at the target at first, animating a frame later, at it afterwards)',
			a.before < a.target && Math.abs(a.now.zoom - a.target) > 1e-3 && a.frames.animated && Math.abs(a.end.zoom - a.target) < 1e-9 && a.end.offset < 1 && !a.end.animated,
			JSON.stringify(a),
		);
	}

	// (c3) Labels at fit zoom on 1280 px: only document and project labels, none overlapping; others on demand.
	{
		const { context, page, errors } = await open('/knowledge/', { width: 1280 });
		await openGraph(page);
		const labels = (cyExpr) => {
			const cy = eval(cyExpr);
			const z = cy.zoom();
			const shown = cy
				.nodes()
				.filter((n) => n.style('display') !== 'none' && n.pstyle('label').strValue !== '' && parseFloat(n.style('font-size')) * z >= parseFloat(n.style('min-zoomed-font-size')));
			const boxes = shown.map((n) => [n.id(), n.boundingBox({ includeLabels: true, includeOverlays: false })]);
			const overlaps = [];
			for (let i = 0; i < boxes.length; i++)
				for (let j = i + 1; j < boxes.length; j++) {
					const [a, A] = boxes[i];
					const [b, B] = boxes[j];
					if (A.x1 < B.x2 && B.x1 < A.x2 && A.y1 < B.y2 && B.y1 < A.y2) overlaps.push(`${a} x ${b}`);
				}
			return { zoom: z, shown: shown.length, kinds: [...new Set(shown.map((n) => n.data('kind')))].sort(), overlaps, positions: cy.nodes().map((n) => [n.id(), n.position()]) };
		};
		const fit = await page.evaluate(labels, CY);
		const major = graph.nodes.filter((n) => ['guide', 'investigation', 'project'].includes(n.kind)).length;
		const fitKinds = fit.kinds.filter((k) => k !== 'technique').join();
		check(
			'labels at fit zoom (1280 px): every guide, investigation and project label, technique labels only if they fit, nothing else',
			fitKinds === 'guide,investigation,project' && (fit.shown === major || fit.shown === major + techniques.length),
			`${fit.shown} shown (${fit.kinds.join(',')}) at zoom ${fit.zoom.toFixed(3)}`,
		);
		check('labels at fit zoom (1280 px): no two visible labels overlap (threshold 0)', fit.overlaps.length === 0, fit.overlaps.slice(0, 5).join(', '));
		// The densest node: selecting it reveals its neighbours' labels and dims the rest.
		const dense = await page.evaluate(
			({ cyExpr }) => {
				const cy = eval(cyExpr);
				const n = cy.nodes().filter((x) => x.style('display') !== 'none').max((x) => x.connectedEdges().filter((e) => e.style('display') !== 'none').length).ele;
				document.querySelector('[data-kg-jump]').value = n.id();
				document.querySelector('[data-kg-jump]').dispatchEvent(new Event('change'));
				return { id: n.id(), near: cy.nodes('.near').length, dim: cy.nodes('.dim').length };
			},
			{ cyExpr: CY },
		);
		const afterSelect = await page.evaluate(labels, CY);
		check('selection: the densest node emphasises its neighbourhood (neighbours labelled, the rest dimmed), no overlapping labels', dense.near > 0 && dense.dim > 0 && afterSelect.overlaps.length === 0, `${dense.id}: ${dense.near} neighbours, ${dense.dim} dimmed, ${afterSelect.shown} labels, ${afterSelect.overlaps.length} overlaps`);
		console.log(`INFO densest node ${dense.id} selected @1280: ${afterSelect.shown} labels, ${afterSelect.overlaps.length} overlapping pairs`);
		await page.keyboard.press('Escape');
		const symptom = graph.nodes.filter((n) => n.kind === 'symptom').sort((a, b) => b.label.length - a.label.length)[0];
		const shownOnSelect = await page.evaluate(
			({ cyExpr, id }) => {
				const cy = eval(cyExpr);
				const before = cy.getElementById(id).pstyle('label').strValue;
				document.querySelector('[data-kg-jump]').value = id;
				document.querySelector('[data-kg-jump]').dispatchEvent(new Event('change'));
				return { before, after: cy.getElementById(id).pstyle('label').strValue, heading: document.querySelector('[data-kg-details] .kg-d-title')?.textContent };
			},
			{ cyExpr: CY, id: symptom.id },
		);
		check(
			'labels: a symptom label appears when selected, short in the graph, in full in the details panel',
			shownOnSelect.before === '' && shownOnSelect.after === symptom.short && shownOnSelect.after.endsWith('…') && shownOnSelect.heading === symptom.label,
			JSON.stringify(shownOnSelect),
		);
		await page.keyboard.press('Escape');
		await page.check('[data-kg-advanced]');
		const zoomed = await page.evaluate((cyExpr) => {
			const cy = eval(cyExpr);
			const before = cy.nodes('[kind = "commit"]').every((n) => n.pstyle('label').strValue === '');
			cy.zoom(1.5);
			return before && cy.nodes('[kind = "commit"], [kind = "symptom"]').every((n) => n.pstyle('label').strValue !== '');
		}, CY);
		check('labels: commit (advanced) and symptom labels appear only when zoomed in', zoomed);
		await page.uncheck('[data-kg-advanced]');
		const again = await open('/knowledge/', { width: 1280 });
		await openGraph(again.page);
		const fit2 = await again.page.evaluate(labels, CY);
		check('layout: deterministic (same positions on a second load)', JSON.stringify(fit2.positions) === JSON.stringify(fit.positions));
		console.log(`INFO labels at fit zoom ${fit.zoom.toFixed(3)} @1280: ${fit.shown} visible, ${fit.overlaps.length} overlapping pairs`);
		allErrors.push(...errors, ...again.errors);
		await again.context.close();
		await context.close();
	}

	// Label overlap at the other widths and in Advanced mode (reported).
	for (const width of [800, 390]) {
		const { context, page, errors } = await open('/knowledge/', { width });
		await openGraph(page);
		const r = await page.evaluate(labelStats, CY);
		await page.check('[data-kg-advanced]');
		const a = await page.evaluate(labelStats, CY);
		console.log(`INFO labels at fit zoom @${width}: ${r.shown} visible, ${r.overlaps} overlapping pairs (zoom ${r.zoom.toFixed(3)}); advanced: ${a.shown} visible, ${a.overlaps} overlapping`);
		check(`labels at fit zoom (${width} px): no overlapping visible labels, default and advanced`, r.overlaps === 0 && a.overlaps === 0, `${r.overlaps}, ${a.overlaps}`);
		allErrors.push(...errors);
		await context.close();
	}

	// (d) 390px: never auto-loads; loads on the button.
	{
		const { context, page, errors, requests } = await open('/knowledge/', { width: 390 });
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.waitForTimeout(1500);
		const early = requests.filter(isGraphAsset);
		check('390px: scrolling to the graph does not load it', early.length === 0, early.join(', '));
		await openGraph(page);
		check('390px: the button loads graph.json and the graph chunk', requests.some((u) => u.endsWith('/knowledge/graph.json')) && requests.some((u) => u.includes('knowledge-graph-view')));
		const h = await page.$eval('[data-kg-canvas]', (c) => c.getBoundingClientRect().height);
		check('390px: graph height sensible', h >= 300 && h <= 900 * 0.75, `${h}px`);
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
		check('390px: no horizontal overflow with the graph open', overflow <= 0, `${overflow}px`);
		allErrors.push(...errors);
		await context.close();
	}

	// Wide screen: no load on first render; auto-load once scrolled into view.
	{
		const { context, page, errors, requests } = await open('/knowledge/', { width: 1280 });
		await page.waitForTimeout(1000);
		check('1280px: initial render loads no graph assets', !requests.some(isGraphAsset));
		await page.evaluate(() => document.querySelector('#graph').scrollIntoView());
		await page.waitForSelector('[data-kb-graph][data-state="ready"]', { timeout: 15000 }).catch(() => {});
		check('1280px: graph auto-loads when scrolled into view', requests.some((u) => u.endsWith('/knowledge/graph.json')));
		allErrors.push(...errors);
		await context.close();
	}

	// (e) Landing page.
	{
		const { context, page, errors } = await open('/');
		const js = [];
		page.on('response', () => {});
		await page.waitForTimeout(800);
		const entries = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => ({ name: e.name, type: e.initiatorType, size: e.encodedBodySize, decoded: e.decodedBodySize })));
		for (const e of entries) if (/\.m?js(\?|$)/.test(e.name)) js.push(e);
		check('/: no graph assets requested', !entries.some((e) => isGraphAsset(e.name)), entries.filter((e) => isGraphAsset(e.name)).map((e) => e.name).join(', '));
		check('/: the only script is the Hero chunk', js.length === 1 && /\/_astro\/Hero\.[^/]*\.js$/.test(js[0].name), js.map((e) => e.name).join(', '));
		const nav = await page.$eval('nav[aria-label="Main"] a[href="/knowledge/"]', (a) => ({ text: a.textContent.trim(), current: a.getAttribute('aria-current') })).catch(() => null);
		check('/: the main navigation links to /knowledge/ (not current)', nav?.text === 'Knowledge' && nav.current === null, JSON.stringify(nav));
		console.log(`INFO /: JS loaded ${js.map((e) => `${e.name.replace(base, '')} ${e.decoded} B`).join(', ')}; total ${js.reduce((a, e) => a + e.decoded, 0)} B`);
		allErrors.push(...errors);
		await context.close();
	}

	// The Knowledge link is the current page on /knowledge/, and on screen at 390 px.
	{
		const { context, page, errors } = await open('/knowledge/', { width: 390 });
		const nav = await page.$eval('nav[aria-label="Main"] a[href="/knowledge/"]', (a) => {
			const r = a.getBoundingClientRect();
			return { current: a.getAttribute('aria-current'), visible: r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight };
		});
		check('/knowledge/: the Knowledge link is marked current and visible at 390 px', nav.current === 'page' && nav.visible, JSON.stringify(nav));
		allErrors.push(...errors);
		await context.close();
	}

	// axe with the graph open, in the default view and in Advanced mode.
	for (const [width, advanced] of [[1280, false], [390, false], [1280, true], [390, true]]) {
		const { context, page, errors } = await open('/knowledge/', { width });
		await openGraph(page);
		if (advanced) await page.check('[data-kg-advanced]');
		await page.click('[data-show-node="win32/waveout-on-sdl-audio.md"]');
		if (inferredCount) await page.check('#show-inferred');
		const violations = await axe(page);
		check(`axe with graph open${advanced ? ' in Advanced mode' : ''} and a node selected @${width}px`, violations.length === 0, violations.join(' | '));
		allErrors.push(...errors);
		await context.close();
	}

	// Screenshots.
	if (shots) {
		await mkdir(shots, { recursive: true });
		for (const width of [390, 800, 1280]) {
			const { context, page } = await open('/knowledge/', { width });
			await page.evaluate(() => document.fonts.ready);
			await page.addStyleTag({ content: '.site-header{position:static !important}' });
			await page.screenshot({ path: `${shots}/knowledge-list-${width}.png`, fullPage: true });
			await openGraph(page);
			await page.click('[data-show-node="recarbon/m6-render-queue-fences.md"]');
			if (inferredCount) await page.check('#show-inferred');
			await page.waitForTimeout(300);
			await page.$eval('#graph', (s) => s.scrollIntoView());
			await (await page.$('#graph')).screenshot({ path: `${shots}/knowledge-graph-${width}.png` });
			await context.close();
		}
		console.log(`INFO screenshots in ${shots}`);
	}

	// (f) Console.
	check('console: no errors on any tested page', allErrors.length === 0, allErrors.join(' | '));
} finally {
	await browser.close();
}
console.log(failures ? `\nknowledge-test: ${failures} failure(s)` : '\nknowledge-test: all checks passed');
process.exit(failures ? 1 : 0);
