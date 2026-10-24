// Cuts the hero laptop out of its studio photo (2000 × 1500, on white) into
// public/hero/laptop-{1600,1200,800}.webp: the white background becomes transparent
// (flood-filled from the border, its anti-aliased edge un-mixed from the white so it
// sits cleanly on the dark hero), the body is graded from the photo's midnight to a
// Space Black finish, the display is blacked out under the live screen
// (src/lib/laptop.ts), and a soft contact shadow goes under the base.
// The photo is used with its rights holder's permission and stays out of the repo:
//   npm run hero-laptop -- path/to/photo.webp     (needs a Playwright Chromium and cwebp, dwebp)
import { chromium } from 'playwright-core';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const input = process.argv[2];
if (!input) throw new Error('usage: node scripts/cut-hero-laptop.mjs <photo>');

const source = await readFile(new URL('src/lib/laptop.ts', root), 'utf8');
const laptop = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

const tmp = await mkdtemp(join(tmpdir(), 'hero-laptop-'));
const browser = await chromium.launch();
try {
	const png = join(tmp, 'photo.png');
	execFileSync('dwebp', ['-quiet', input, '-o', png]); // also accepts a PNG
	const page = await browser.newPage();
	await page.setContent('<!doctype html>');
	await page.addScriptTag({ content: laptop.replace(/^export /gm, '') });
	const out = await page.evaluate(async (data) => {
		const img = new Image();
		img.src = `data:image/png;base64,${data}`;
		await img.decode();
		const { width: w, height: h } = img;
		const c = new OffscreenCanvas(w, h);
		const g = c.getContext('2d');
		g.drawImage(img, 0, 0);
		const im = g.getImageData(0, 0, w, h);
		const px = im.data;
		const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

		// Background: near-white pixels connected to the border.
		const bg = new Uint8Array(w * h);
		// (the body touches the frame's bottom edge, whose last row is its anti-aliasing)
		const white = (p) => Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]) >= (p >= w * (h - 1) ? 140 : 232);
		const stack = [];
		for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
		for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
		while (stack.length) {
			const p = stack.pop();
			if (bg[p] || !white(p)) continue;
			bg[p] = 1;
			const x = p % w;
			if (x > 0) stack.push(p - 1);
			if (x < w - 1) stack.push(p + 1);
			if (p >= w) stack.push(p - w);
			if (p < w * (h - 1)) stack.push(p + w);
		}
		// Edge band, 1 px either side of the boundary (the photo's anti-aliasing): alpha from how far each pixel is from white
		// towards the nearest solid body colour, then the white un-mixed from its colour.
		const R = 1;
		const near = (p, want) => {
			const x = p % w, y = (p - x) / w;
			for (let dy = -R; dy <= R; dy++)
				for (let dx = -R; dx <= R; dx++) {
					const xx = x + dx, yy = y + dy;
					if (xx >= 0 && yy >= 0 && xx < w && yy < h && bg[yy * w + xx] === want) return true;
				}
			return false;
		};
		const alpha = new Float32Array(w * h);
		for (let p = 0; p < w * h; p++) {
			if (!near(p, bg[p] ? 0 : 1)) {
				alpha[p] = bg[p] ? 0 : 1;
				continue;
			}
			// the darkest body pixel close by stands for the solid colour
			const x = p % w, y = (p - x) / w;
			let body = 255;
			for (let dy = -3; dy <= 3; dy++)
				for (let dx = -3; dx <= 3; dx++) {
					const xx = x + dx, yy = y + dy;
					if (xx >= 0 && yy >= 0 && xx < w && yy < h && !bg[yy * w + xx]) body = Math.min(body, lum((yy * w + xx) * 4));
				}
			alpha[p] = Math.min(1, Math.max(0, (255 - lum(p * 4)) / Math.max(1, 255 - body)));
		}
		// Space Black: most of the blue taken out, mid-tones pressed down, highlights kept.
		const grade = (x) => 255 * Math.pow(x / 255, 1.75);
		for (let p = 0; p < w * h; p++) {
			const a = alpha[p], i = p * 4;
			if (a > 0 && a < 1) for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, Math.max(0, (px[i + k] - (1 - a) * 255) / a));
			const l = lum(i);
			const tint = [0.985, 1, 1.04]; // a trace of cool in the metal
			for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, grade(l + (px[i + k] - l) * 0.28) * tint[k]);
			px[i + 3] = Math.round(a * 255);
		}
		g.putImageData(im, 0, 0);

		// The display, under the live screen: black, 1.5 px inside its edges, top corners rounded.
		const [tl, tr, br, bl] = DISPLAY.corners;
		const inset = 1.5, r = DISPLAY.radius * (tr[0] - tl[0]);
		g.fillStyle = '#000';
		g.beginPath();
		g.moveTo(tl[0] + inset, tl[1] + inset + r);
		g.arcTo(tl[0] + inset, tl[1] + inset, tr[0] - inset, tr[1] + inset, r);
		g.arcTo(tr[0] - inset, tr[1] + inset, br[0] - inset, br[1] - inset, r);
		g.lineTo(br[0] - inset, br[1] - inset);
		g.lineTo(bl[0] + inset, bl[1] - inset);
		g.closePath();
		g.fill();

		// The published canvas: contact shadow, then the cut-out photo.
		const o = new OffscreenCanvas(IMAGE.width, IMAGE.height);
		const og = o.getContext('2d');
		const X = PHOTO.left, Y = PHOTO.top;
		let bottom = 0, left = w, right = 0;
		for (let p = 0; p < w * h; p++)
			if (px[p * 4 + 3] > 128) {
				const x = p % w;
				bottom = Math.max(bottom, (p - x) / w);
				left = Math.min(left, x);
				right = Math.max(right, x);
			}
		const cy = PHOTO.top + bottom - 4, cx = PHOTO.left + (left + right) / 2, rx = (right - left) / 2;
		og.filter = 'blur(14px)';
		og.fillStyle = 'rgb(0 0 0 / 0.55)';
		og.beginPath();
		og.ellipse(cx, cy, rx * 0.96, 16, 0, 0, Math.PI * 2);
		og.fill();
		og.filter = 'blur(40px)';
		og.fillStyle = 'rgb(0 0 0 / 0.35)';
		og.beginPath();
		og.ellipse(cx, cy + 14, rx * 0.9, 34, 0, 0, Math.PI * 2);
		og.fill();
		og.filter = 'none';
		og.drawImage(c, X, Y);
		const blob = await o.convertToBlob({ type: 'image/png' });
		return new Promise((done) => {
			const reader = new FileReader();
			reader.onload = () => done(reader.result.split(',')[1]);
			reader.readAsDataURL(blob);
		});
	}, (await readFile(png)).toString('base64'));
	const master = join(tmp, 'laptop.png');
	await writeFile(master, Buffer.from(out, 'base64'));
	for (const width of [1600, 1200, 800]) {
		const dest = fileURLToPath(new URL(`public/hero/laptop-${width}.webp`, root));
		execFileSync('cwebp', ['-quiet', '-q', '82', '-alpha_q', '90', '-m', '6', '-sharp_yuv', '-resize', String(width), '0', master, '-o', dest]);
		console.log(`wrote public/hero/laptop-${width}.webp`);
	}
} finally {
	await browser.close();
	await rm(tmp, { recursive: true, force: true });
}
