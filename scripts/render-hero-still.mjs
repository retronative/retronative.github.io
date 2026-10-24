// Renders public/hero/platformer-still.png: the hero platformer's still frame (STILL_T),
// 160 × 100 game pixels, from src/lib/platformer.ts itself. The page shows it without
// JS; with JS the same frame is drawn live. Run after changing the scene:
//   npm run hero-still      (needs a Playwright Chromium: npx playwright-core install chromium)
import { chromium } from 'playwright-core';
import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/lib/platformer.ts', root), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.setContent('<!doctype html><canvas width="160" height="100"></canvas>');
	await page.addScriptTag({
		type: 'module',
		content: `${js.replace(/^export /gm, '')}
const c = document.querySelector('canvas');
createScene()(c.getContext('2d'), STILL_T, 1);
window.png = c.toDataURL('image/png');`,
	});
	const png = await page.waitForFunction(() => window.png).then((h) => h.jsonValue());
	await mkdir(new URL('public/hero/', root), { recursive: true });
	await writeFile(new URL('public/hero/platformer-still.png', root), Buffer.from(png.split(',')[1], 'base64'));
	console.log('wrote public/hero/platformer-still.png');
} finally {
	await browser.close();
}
