// Renders the site's Open Graph image (public/og/retronative.png, 1200x630) from the
// HTML below: the wordmark, the mission line and the grid texture. Original artwork,
// no game material. Run after changing it: npm run og
// Needs a Playwright Chromium (npx playwright-core install chromium).
import { chromium } from 'playwright-core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const font = (p) => new URL(`node_modules/${p}`, root).href;
const out = fileURLToPath(new URL('public/og/retronative.png', root));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Chakra Petch'; font-weight: 700; src: url(${font('@fontsource/chakra-petch/files/chakra-petch-latin-700-normal.woff2')}); }
@font-face { font-family: 'Chakra Petch'; font-weight: 500; src: url(${font('@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2')}); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: url(${font('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')}); }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1200px; height: 630px; }
body {
	position: relative; overflow: hidden; color: #e9eef5; font-family: 'Chakra Petch';
	background:
		repeating-linear-gradient(0deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 3px),
		linear-gradient(rgb(25 227 255 / 0.07) 1px, transparent 1px) 0 0 / 40px 40px,
		linear-gradient(90deg, rgb(25 227 255 / 0.07) 1px, transparent 1px) 0 0 / 40px 40px,
		radial-gradient(700px 420px at 0% 0%, rgb(25 227 255 / 0.22), transparent 70%),
		radial-gradient(700px 420px at 100% 100%, rgb(255 77 46 / 0.2), transparent 70%),
		#07080b;
}
.frame { position: absolute; inset: 40px; border: 1px solid #3a4250; }
.content { position: absolute; left: 96px; right: 96px; top: 150px; }
.mark { display: flex; align-items: baseline; font-weight: 700; font-size: 112px; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1; }
.mark .n { color: #19e3ff; }
.joint { display: inline-block; width: 0.32em; height: 0.72em; margin: 0 0.12em; background: linear-gradient(180deg, #19e3ff, #ff4d2e); transform: skewX(-12deg); }
.rule { width: 360px; height: 3px; margin: 40px 0 36px; background: linear-gradient(90deg, #19e3ff, #ff4d2e 60%, transparent); }
.line { max-width: 900px; font-weight: 500; font-size: 44px; line-height: 1.2; }
.tag { position: absolute; left: 96px; bottom: 84px; font-family: 'JetBrains Mono'; font-size: 22px; letter-spacing: 0.12em; color: #8a94a6; text-transform: uppercase; }
.tag b { font-weight: 400; color: #c6ff3d; }
</style></head><body>
<div class="frame"></div>
<div class="content">
	<div class="mark"><span>Retro</span><span class="joint"></span><span class="n">Native</span></div>
	<div class="rule"></div>
	<div class="line">Bringing classic games to modern platforms through native recompilation.</div>
</div>
<div class="tag"><b>&gt;</b> retronative.github.io</div>
</body></html>`;

// A file:// page, so it may load the fonts from node_modules.
const dir = await mkdtemp(join(tmpdir(), 'rn-og-'));
const file = join(dir, 'og.html');
await writeFile(file, html);
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
	await page.evaluate(() => document.fonts.ready);
	await mkdir(new URL('public/og/', root), { recursive: true });
	await page.screenshot({ path: out, type: 'png' });
	console.log(`wrote ${out}`);
} finally {
	await browser.close();
	await rm(dir, { recursive: true, force: true });
}
