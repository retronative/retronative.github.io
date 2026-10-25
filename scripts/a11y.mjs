// Accessibility and layout checks against a running preview (npm run preview).
//   node scripts/a11y.mjs [base-url]      default http://127.0.0.1:4400
// For every page in the sitemap, plus the 404 page, at 1280, 800 and 390 px:
// - axe-core 4.10.2 (loaded from cdnjs into the page): WCAG 2.0/2.1 A and AA and best practices;
// - no horizontal overflow;
// - keyboard: every Tab stop is visible on screen and shows a focus indicator.
// With prefers-reduced-motion: reduce, no animation runs (CSS or canvas) and no transition has a duration.
// /knowledge/ again with its interactive graph open and a node selected: axe and overflow at every width, and no
// animation under reduced motion.
// Needs a Playwright Chromium (npx playwright-core install chromium).
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? 'http://127.0.0.1:4400').replace(/\/$/, '');
const AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const widths = [1280, 800, 390];

const sitemap = await (await fetch(`${base}/sitemap-0.xml`)).text();
const paths = [...sitemap.matchAll(/<loc>https:\/\/retronative\.github\.io([^<]+)<\/loc>/g)].map((m) => m[1]);
paths.push('/404.html');

const problems = [];
const browser = await chromium.launch();
try {
	for (const width of widths) {
		const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
		const page = await context.newPage();
		for (const path of paths) {
			const where = `${path} @${width}px`;
			await page.goto(`${base}${path}`, { waitUntil: 'load' });
			await page.evaluate(() => document.fonts.ready);
			await page.waitForTimeout(500);

			await page.addScriptTag({ url: AXE });
			const result = await page.evaluate(async () => {
				const r = await /** @type {any} */ (window).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] });
				return {
					violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) })),
					passes: r.passes.length,
					incomplete: r.incomplete.map((v) => v.id),
					// Text axe could not measure (over gradients or textures): checked by hand.
					review: r.incomplete.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`)),
				};
			});
			if (process.env.A11Y_VERBOSE) for (const r of result.review) console.log(`  review ${r}`);
			for (const v of result.violations) problems.push(`${where}: axe ${v.id} (${v.impact}) at ${v.nodes.slice(0, 3).join(', ')}`);

			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			if (overflow > 0) problems.push(`${where}: horizontal overflow of ${overflow}px`);

			// Keyboard walk: Tab through every stop and back to the start.
			await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
			await page.evaluate(() => {
				window.scrollTo(0, 0);
				// @ts-ignore
				document.activeElement?.blur();
			});
			const stops = [];
			for (let i = 0; i < 400; i++) {
				await page.keyboard.press('Tab');
				const info = await page.evaluate(() => {
					const el = document.activeElement;
					if (!el || el === document.body) return null;
					const cs = getComputedStyle(el);
					const r = el.getBoundingClientRect();
					const card = el.closest('.card');
					const cardCs = card ? getComputedStyle(card) : null;
					const indicator =
						(cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) ||
						cs.boxShadow !== 'none' ||
						(cardCs && cardCs.outlineStyle !== 'none' && parseFloat(cardCs.outlineWidth) >= 2);
					const header = document.querySelector('.site-header');
					const hb = header && getComputedStyle(header).position === 'sticky' && !header.contains(el) ? header.getBoundingClientRect().bottom : 0;
					const onScreen = r.width > 0 && r.height > 0 && r.bottom > hb && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
					return { skip: el.classList.contains('skip'), label: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`, indicator, onScreen, href: el.getAttribute('href') };
				});
				if (!info) break;
				if (stops.length && stops[0].label === info.label && stops[0].href === info.href) break;
				stops.push(info);
				if (!info.indicator) problems.push(`${where}: no focus indicator on ${info.label}`);
				if (!info.onScreen && !info.skip) problems.push(`${where}: focused ${info.label} is off screen`);
			}
			console.log(`${where}: axe ${result.violations.length} violations, ${result.passes} rules passed${result.incomplete.length ? `, needs review: ${result.incomplete.join(', ')}` : ''}; overflow ${Math.max(0, overflow)}px; ${stops.length} tab stops`);
		}
		await context.close();
	}

	// Reduced motion.
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
	const page = await context.newPage();
	for (const path of paths) {
		await page.goto(`${base}${path}`, { waitUntil: 'load' });
		const motion = await page.evaluate(() => {
			const timed = [...document.querySelectorAll('*')].filter((el) => {
				const cs = getComputedStyle(el);
				const dur = (v) => v.split(',').some((d) => parseFloat(d) > 0);
				return dur(cs.transitionDuration) || (cs.animationName !== 'none' && dur(cs.animationDuration));
			});
			const games = [...document.querySelectorAll('canvas[data-state]')].filter((c) => c.dataset.state !== 'paused').length;
			return { games, animations: document.getAnimations().length, timed: timed.map((el) => el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : '')), scroll: getComputedStyle(document.documentElement).scrollBehavior };
		});
		if (motion.games) problems.push(`${path} (reduced motion): ${motion.games} canvas animation(s) running`);
		if (motion.animations) problems.push(`${path} (reduced motion): ${motion.animations} animation(s) running`);
		if (motion.timed.length) problems.push(`${path} (reduced motion): timed transitions on ${motion.timed.slice(0, 5).join(', ')}`);
		if (motion.scroll !== 'auto') problems.push(`${path} (reduced motion): scroll-behavior ${motion.scroll}`);
		console.log(`${path} (reduced motion): ${motion.animations} animations, ${motion.timed.length} timed elements, scroll-behavior ${motion.scroll}`);
	}
	await context.close();

	if (paths.includes('/knowledge/')) {
		for (const [width, reducedMotion] of [...widths.map((w) => [w, 'no-preference']), [1280, 'reduce']]) {
			const where = `/knowledge/ (graph open${reducedMotion === 'reduce' ? ', reduced motion' : ''}) @${width}px`;
			const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
			const page = await context.newPage();
			await page.goto(`${base}/knowledge/`, { waitUntil: 'load' });
			await page.click('[data-kg-open]');
			await page.waitForSelector('[data-kb-graph][data-state="ready"]', { timeout: 15000 });
			await page.click('[data-show-node]');
			await page.waitForTimeout(500);
			await page.addScriptTag({ url: AXE });
			const violations = await page.evaluate(async () => {
				const r = await /** @type {any} */ (window).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] });
				return r.violations.map((v) => `${v.id} (${v.impact}) at ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
			});
			for (const v of violations) problems.push(`${where}: axe ${v}`);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			if (overflow > 0) problems.push(`${where}: horizontal overflow of ${overflow}px`);
			const animations = reducedMotion === 'reduce' ? await page.evaluate(() => document.getAnimations().length) : 0;
			if (animations) problems.push(`${where}: ${animations} animation(s) running`);
			console.log(`${where}: axe ${violations.length} violations; overflow ${Math.max(0, overflow)}px${reducedMotion === 'reduce' ? `; ${animations} animations` : ''}`);
			await context.close();
		}
	}
} finally {
	await browser.close();
}

if (problems.length) {
	console.error(`\na11y: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`);
	process.exit(1);
}
console.log(`\na11y: ${paths.length} pages x ${widths.length} widths, 0 problems`);
