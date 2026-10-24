// An original 8-bit side-scroller for the hero's laptop screen: a helmeted runner
// jumps a crate and a pit, bumps a block that releases a sprout power-up, grows,
// stomps a one-eyed beetle and runs on. All art and the level are original.
//
// The loop is seamless by construction: the level is one segment of L pixels that
// repeats, the camera moves at SPEED, so one loop lasts L / SPEED seconds. Every
// object's state is a function of its own clock s = t - n * LOOP (n = which copy of
// the segment it belongs to), so when the camera reaches the next copy, everything
// on screen is in exactly the state it was in at t = 0. The runner's own timeline
// starts and ends small, on the ground, mid-stride.

export const W = 160; // virtual screen, in game pixels
export const H = 100;
const FAR_W = 192; // the far layer moves at half speed: 192 px per loop
const NEAR_W = 288; // the near layer at three-quarter speed: 288 px per loop
const L = 384; // level segment length
const SPEED = 56; // camera and runner speed, px/s
export const LOOP = L / SPEED; // 6.857 s
const G = 480; // gravity, px/s²
const GROUND = 84; // y of the ground's top edge
const HERO_X = 56; // the runner's fixed screen x (centre)
/** The still (no JS, reduced motion): the power-up rising from its block, the runner dropping back, coins ahead. */
export const STILL_T = 2.42;

// ---------------------------------------------------------------------------
// Palette and sprites (one character per pixel; '.' is transparent).

const P: Record<string, string> = {
	h: '#0e7fa0', H: '#19e3ff', v: '#1b1f3a', W: '#ffffff', S: '#ff4d2e', u: '#3a4fd8', U: '#5b70f0', k: '#f6c79b', b: '#2b1d16',
	m: '#6e1f86', M: '#c23fd0', p: '#1b1f3a', l: '#2b1d16',
	g: '#5f9a12', G: '#c6ff3d', c: '#e9d3a8', C: '#fff6e2',
	o: '#b07400', O: '#ffd23f', y: '#fff3a6',
};

const HEAD = ['...hhhh...', '..hHHHHh..', '.hHHHvvvh.', '.hHHvWvvh.', '.hHHHvvvh.', '..hhhhhh..', 'SSSSSSSh..'];
const SMALL_BODY = ['..uuuuuk..', '.kuUuuuu..', '..uuuuuu..'];
const BIG_BODY = ['..uuuuuuk.', '.kuUUuuuu.', '.kuUuuuuu.', '..uuuuuu..', '..uuuuuu..', '..SSSSSS..', '..uuuuuu..', '..uuuuuu..'];
const LEGS = [
	['.uu...uu..', 'bb.....bb.'],
	['...uuuu...', '...bbbb...'],
	['..uu.uu...', '.bb...bb..'],
	['...uuuu...', '...bbbb...'],
];
const JUMP_LEGS = ['.uu..uu...', '.bb....bb.'];

const ENEMY = [
	['...mmmm...', '..mMMMMm..', '.mMMWWWMm.', '.mMWWpWMm.', 'mMMMWWWMMm', 'mMMMMMMMMm', '.mmmmmmmm.', '..l....l..', '.ll....ll.'],
	['...mmmm...', '..mMMMMm..', '.mMMWWWMm.', '.mMWWpWMm.', 'mMMMWWWMMm', 'mMMMMMMMMm', '.mmmmmmmm.', '...l..l...', '..ll..ll..'],
];
const ENEMY_FLAT = ['.mmmmmmmm.', 'mMMWpWMMMm', 'mMMMMMMMMm', '.llmmmmll.'];
const SPROUT = ['..gGGg..', '.gGWGGg.', 'gGWWGGGg', 'gGGGGWGg', 'gggggggg', '..cCCc..', '..cCcc..', '..cccc..'];
const COIN = [
	['.oooo.', 'oOyOOo', 'oOyOOo', 'oOyOOo', 'oOyOOo', 'oOyOOo', 'oOOOOo', '.oooo.'],
	['..oo..', '.oyOo.', '.oyOo.', '.oyOo.', '.oyOo.', '.oyOo.', '.oOOo.', '..oo..'],
	['..o...', '..y...', '..y...', '..O...', '..O...', '..O...', '..O...', '..o...'],
	['..oo..', '.oyOo.', '.oyOo.', '.oyOo.', '.oyOo.', '.oyOo.', '.oOOo.', '..oo..'],
];

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function canvas(w: number, h: number): Canvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}
const ctx2d = (c: Canvas) => c.getContext('2d') as Ctx;

function sprite(rows: string[]): Canvas {
	const c = canvas(rows[0].length, rows.length);
	const x = ctx2d(c);
	rows.forEach((row, y) => [...row].forEach((ch, i) => ch !== '.' && ((x.fillStyle = P[ch]), x.fillRect(i, y, 1, 1))));
	return c;
}

// ---------------------------------------------------------------------------
// Physics helpers and the scripted timeline.

type Arc = { t0: number; t1: number; y0: number; vy: number };
const heightOn = (a: Arc, t: number) => a.y0 + a.vy * (t - a.t0) - (G / 2) * (t - a.t0) ** 2;
/** A jump from height y0 to y1 lasting d seconds. */
const jump = (t0: number, d: number, y0: number, y1: number): Arc => ({ t0, t1: t0 + d, y0, vy: (y1 - y0 + (G / 2) * d * d) / d });
/** Time to fall (or rise and fall) from y0 with vy down to y1. */
const fallTime = (y0: number, vy: number, y1: number) => (vy + Math.sqrt(vy * vy + 2 * G * (y0 - y1))) / G;
const heroXAt = (s: number) => HERO_X + SPEED * s; // runner's centre, in segment coordinates

// Block row: bricks either side of a power-up block, bottoms 36 px above the ground.
const BLOCK_X = 176;
const BLOCK_BOTTOM = 36;
const SMALL_H = 12;
const BIG_H = 17;

// Head-bump: rise at 200 px/s until the head meets the block, then drop.
const bumpRise = (200 - Math.sqrt(200 * 200 - 2 * G * (BLOCK_BOTTOM - SMALL_H))) / G;
const bumpT0 = (BLOCK_X + 4 - SPEED * bumpRise - HERO_X) / SPEED; // head meets the block's centre
const bumpAt = bumpT0 + bumpRise;

// The enemy walks left at 20 px/s and is stomped where the runner lands on it.
const ENEMY_H = 9;
const stomp = jump(4.25, 0.6, 0, ENEMY_H);
const enemyX0 = heroXAt(stomp.t1) + 3 + 20 * stomp.t1;
const bounce: Arc = { t0: stomp.t1, y0: ENEMY_H, vy: 150, t1: stomp.t1 + fallTime(ENEMY_H, 150, 0) };

const arcs: Arc[] = [
	jump(0.45, 0.75, 0, 0), // over the crate
	jump(1.3214, 0.5714, 0, 0), // over the pit
	{ t0: bumpT0, t1: bumpAt, y0: 0, vy: 200 }, // into the block
	{ t0: bumpAt, t1: bumpAt + fallTime(BLOCK_BOTTOM - SMALL_H, 0, 0), y0: BLOCK_BOTTOM - SMALL_H, vy: 0 },
	stomp,
	bounce,
];

// The sprout: rises out of the block, hops forward, lands and walks right at 24 px/s
// until the runner catches it.
const sproutRise = [bumpAt, bumpAt + 0.28] as const;
const sproutHop: Arc = { t0: sproutRise[1], y0: BLOCK_BOTTOM + 8, vy: 120, t1: sproutRise[1] + fallTime(BLOCK_BOTTOM + 8, 120, 0) };
const sproutLandX = BLOCK_X + 4 + 100 * (sproutHop.t1 - sproutHop.t0);
const caught = (sproutLandX - 24 * sproutHop.t1 - HERO_X - 7) / (SPEED - 24);
const GROW = [caught, caught + 0.3] as const;
const SHRINK = [5.9, 6.2] as const; // the power-up wears off well before the loop ends

function heroAt(t: number) {
	const arc = arcs.find((a) => t >= a.t0 && t < a.t1);
	const h = arc ? heightOn(arc, t) : 0;
	const flick = (a: number) => Math.floor((t - a) / 0.05) % 2 === 0;
	let big = t >= GROW[1] && t < SHRINK[0];
	if (t >= GROW[0] && t < GROW[1]) big = flick(GROW[0]);
	if (t >= SHRINK[0] && t < SHRINK[1]) big = !flick(SHRINK[0]);
	return { h, air: !!arc, big };
}

// Coins sit on the runner's path, so each one is collected as the runner passes it.
const coins = [92, 102, 112, 146, 214, 226, 300, 312, 322].map((x) => {
	const s = (x - HERO_X) / SPEED;
	const hero = heroAt(s);
	return { x, s, y: GROUND - hero.h - (hero.big ? 10 : 6) };
});

// ---------------------------------------------------------------------------
// Static art: sky, two parallax layers and the level segment.

function buildSky(): Canvas {
	const c = canvas(W, H);
	const x = ctx2d(c);
	const bands = ['#62c3f2', '#79cff6', '#93dbf9', '#b2e7fb', '#cdf1fd'];
	bands.forEach((col, i) => {
		x.fillStyle = col;
		x.fillRect(0, i * 15, W, H - i * 15);
		// a 1-px dither row between bands
		x.fillStyle = bands[i + 1] ?? col;
		for (let px = i % 2; px < W; px += 2) x.fillRect(px, i * 15 + 14, 1, 1);
	});
	return c;
}

/** A periodic height map over width w, from a few sine bumps. */
function ridge(w: number, x: number, waves: [number, number, number][]) {
	return waves.reduce((sum, [amp, period, phase]) => sum + amp * Math.sin(((x / w) * period + phase) * Math.PI * 2), 0);
}

function buildFar(): Canvas {
	const w = FAR_W;
	const c = canvas(w, H);
	const x = ctx2d(c);
	for (let px = 0; px < w; px++) {
		const top = Math.round(GROUND - 24 + ridge(w, px, [[6, 2, 0.1], [3, 5, 0.3], [1.5, 9, 0.7]]));
		x.fillStyle = '#9a90e6';
		x.fillRect(px, top, 1, GROUND - top);
		x.fillStyle = '#b4acf2';
		if ((px + top) % 3 === 0) x.fillRect(px, top, 1, 1);
	}
	const cloud = (cx: number, cy: number, r: number) => {
		for (const dx of [-w, 0, w]) {
			x.fillStyle = '#ffffff';
			for (const [ox, oy, rr] of [[0, 0, r], [-r, 2, r - 2], [r, 2, r - 2], [r * 1.8, 4, r - 4]] as const)
				for (let yy = -rr; yy <= rr; yy++) {
					const half = Math.floor(Math.sqrt(rr * rr - yy * yy));
					x.fillRect(Math.round(cx + ox - half + dx), Math.round(cy + oy + yy), half * 2, 1);
				}
			x.fillStyle = '#dff3fb';
			x.fillRect(Math.round(cx - r * 2 + dx + 1), cy + r - 1, Math.round(r * 4.4), 1);
		}
	};
	cloud(30, 16, 6);
	cloud(130, 26, 5);
	return c;
}

function buildNear(): Canvas {
	const w = NEAR_W;
	const c = canvas(w, H);
	const x = ctx2d(c);
	for (let px = 0; px < w; px++) {
		const top = Math.round(GROUND - 13 + ridge(w, px, [[5, 3, 0.2], [3, 7, 0.55], [1.5, 12, 0.1]]));
		x.fillStyle = '#2f9e5a';
		x.fillRect(px, top, 1, GROUND - top);
		x.fillStyle = '#5cc779';
		x.fillRect(px, top, 1, 2);
		if (px % 7 === 3) {
			x.fillStyle = '#257d48';
			x.fillRect(px, top + 6, 1, 1);
		}
	}
	return c;
}

function buildLevel(): Canvas {
	const c = canvas(L, H);
	const x = ctx2d(c);
	const px = (col: string, X: number, Y: number, w = 1, h = 1) => ((x.fillStyle = col), x.fillRect(X, Y, w, h));
	const pit = [136, 152];
	for (let X = 0; X < L; X++) {
		if (X >= pit[0] && X < pit[1]) {
			px('#1d2c4f', X, GROUND + 2, 1, H - GROUND);
			continue;
		}
		px('#9be04f', X, GROUND, 1, 2);
		px(X % 4 === 0 ? '#5fae2f' : '#9be04f', X, GROUND + 2);
		px('#c8743c', X, GROUND + 3, 1, H - GROUND - 3);
		if ((X * 7) % 11 === 0) px('#e09a5a', X, GROUND + 6 + (X % 3) * 3);
		if ((X * 5) % 13 === 0) px('#9a5328', X, GROUND + 9 + (X % 2) * 4);
	}
	// pit edges
	px('#5fae2f', pit[0] - 1, GROUND, 1, H - GROUND);
	px('#5fae2f', pit[1], GROUND, 1, H - GROUND);
	// flowers
	for (const [X, col] of [[24, '#ff4d2e'], [60, '#ffffff'], [206, '#ffb02e'], [262, '#ff4d2e'], [350, '#ffffff']] as const) {
		px('#2f9e5a', X, GROUND - 2, 1, 2);
		px(col, X - 1, GROUND - 3, 3, 1);
		px(col, X, GROUND - 4);
	}
	// crate, 16 × 16, on the ground
	const cx = 96;
	const cy = GROUND - 16;
	px('#6e4a2c', cx, cy, 16, 16);
	px('#a7754a', cx + 1, cy + 1, 14, 14);
	px('#d4a06a', cx + 1, cy + 1, 14, 1);
	px('#6e4a2c', cx + 1, cy + 7, 14, 1);
	for (let i = 1; i < 15; i++) px('#8b5e36', cx + i, cy + i);
	// bricks either side of the block
	for (const bx of [BLOCK_X - 8, BLOCK_X + 8]) {
		const by = GROUND - BLOCK_BOTTOM - 8;
		px('#7a2f1d', bx, by, 8, 8);
		px('#d9603b', bx, by, 7, 3);
		px('#d9603b', bx + 1, by + 4, 7, 3);
		px('#f08a5d', bx, by, 7, 1);
	}
	return c;
}

function blockSprite(used: boolean): Canvas {
	const c = canvas(8, 8);
	const x = ctx2d(c);
	x.fillStyle = used ? '#5a3a26' : '#b86e0a';
	x.fillRect(0, 0, 8, 8);
	x.fillStyle = used ? '#8a5a3a' : '#ffb02e';
	x.fillRect(1, 1, 6, 6);
	x.fillStyle = used ? '#5a3a26' : '#ffe08a';
	for (const [X, Y] of [[1, 1], [6, 1], [1, 6], [6, 6]]) x.fillRect(X, Y, 1, 1);
	if (!used) {
		x.fillStyle = '#ffffff';
		x.fillRect(3, 2, 2, 4);
		x.fillRect(2, 3, 4, 2);
	}
	return c;
}

// ---------------------------------------------------------------------------

export function createScene() {
	const sky = buildSky();
	const far = buildFar();
	const near = buildNear();
	const level = buildLevel();
	const block = blockSprite(false);
	const blockUsed = blockSprite(true);
	const small = LEGS.map((legs) => sprite([...HEAD, ...SMALL_BODY, ...legs]));
	const big = LEGS.map((legs) => sprite([...HEAD, ...BIG_BODY, ...legs]));
	const smallJump = sprite([...HEAD, ...SMALL_BODY, ...JUMP_LEGS]);
	const bigJump = sprite([...HEAD, ...BIG_BODY, ...JUMP_LEGS]);
	const enemy = ENEMY.map(sprite);
	const enemyFlat = sprite(ENEMY_FLAT);
	const sprout = sprite(SPROUT);
	const coin = COIN.map(sprite);

	/**
	 * Draws the frame at time t (seconds, unbounded) into ctx, at k device pixels per
	 * game pixel. Positions snap to 1/k of a game pixel: crisp pixels, smooth scrolling.
	 */
	return function draw(ctx: Ctx, t: number, k: number) {
		const snap = (v: number) => Math.round(v * k) / k;
		const cam = SPEED * t;
		const phase = ((t % LOOP) + LOOP) % LOOP;
		ctx.setTransform(k, 0, 0, k, 0, 0);
		ctx.imageSmoothingEnabled = false;
		const img = (src: Canvas, X: number, Y: number) => ctx.drawImage(src, snap(X), snap(Y));

		img(sky, 0, 0);
		const farOff = (cam * 0.5) % FAR_W;
		img(far, -farOff, 0);
		img(far, FAR_W - farOff, 0);
		const nearOff = (cam * 0.75) % NEAR_W;
		img(near, -nearOff, 0);
		img(near, NEAR_W - nearOff, 0);

		const first = Math.floor(cam / L);
		for (let n = first; n <= first + 1; n++) img(level, n * L - cam, 0);

		// Objects of each segment copy, on their own clock s.
		const coinFrame = Math.floor((phase / LOOP) * 48) % 4;
		for (let n = first - 1; n <= first + 1; n++) {
			const s = t - n * LOOP;
			const at = (X: number) => n * L + X - cam;

			// sprout (drawn before its block, so it rises from behind it)
			if (s >= sproutRise[0] && s < caught) {
				let sx = BLOCK_X + 4;
				let sb = BLOCK_BOTTOM + 8;
				if (s < sproutRise[1]) sb = BLOCK_BOTTOM + 8 * ((s - sproutRise[0]) / (sproutRise[1] - sproutRise[0]));
				else if (s < sproutHop.t1) {
					sx += 100 * (s - sproutHop.t0);
					sb = heightOn(sproutHop, s);
				} else {
					sx = sproutLandX + 24 * (s - sproutHop.t1);
					sb = 0;
				}
				img(sprout, at(sx - 4), GROUND - sb - 8);
			}

			// the block, bumped up for a moment when hit
			const bump = s >= bumpAt && s < bumpAt + 0.12 ? 3 * Math.sin(((s - bumpAt) / 0.12) * Math.PI) : 0;
			img(s >= bumpAt ? blockUsed : block, at(BLOCK_X), GROUND - BLOCK_BOTTOM - 8 - bump);

			for (const c of coins) {
				if (s < c.s) img(coin[coinFrame], at(c.x - 3), c.y - 4);
				else if (s < c.s + 0.3) {
					// a two-pixel glint rising from where the coin was
					const k2 = (s - c.s) / 0.3;
					ctx.fillStyle = k2 < 0.5 ? '#fff3a6' : '#ffd23f';
					ctx.fillRect(snap(at(c.x - 1)), snap(c.y - 4 - 8 * k2), 2, 2);
				}
			}

			// the beetle
			if (s < stomp.t1) img(enemy[Math.floor(s * 6) % 2 === 0 ? 0 : 1], at(enemyX0 - 20 * s - 5), GROUND - ENEMY_H);
			else if (s < stomp.t1 + 0.35) img(enemyFlat, at(enemyX0 - 20 * stomp.t1 - 5), GROUND - 4);
			else if (s < stomp.t1 + 0.55) {
				ctx.fillStyle = '#ffffff';
				const r = 3 + 10 * (s - stomp.t1 - 0.35);
				for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-0.7, -0.7], [0.7, -0.7]]) ctx.fillRect(snap(at(enemyX0 - 20 * stomp.t1) + dx * r), snap(GROUND - 3 + dy * r), 1, 1);
			}
		}

		// the runner
		const hero = heroAt(phase);
		const stride = Math.floor((HERO_X + cam) / 8) % 4;
		const spr = hero.big ? (hero.air ? bigJump : big[stride]) : hero.air ? smallJump : small[stride];
		img(spr, HERO_X - 5, GROUND - hero.h - (hero.big ? BIG_H : SMALL_H));
		// sparkles while growing and when the power-up wears off
		for (const [a, b] of [GROW, SHRINK]) {
			if (phase < a || phase >= b + 0.15) continue;
			const q = (phase - a) / (b + 0.15 - a);
			ctx.fillStyle = Math.floor(q * 8) % 2 ? '#ffffff' : '#c6ff3d';
			for (let i = 0; i < 6; i++) {
				const ang = q * 5 + (i * Math.PI) / 3;
				ctx.fillRect(snap(HERO_X + Math.cos(ang) * (7 + 4 * q)), snap(GROUND - hero.h - 10 + Math.sin(ang) * (9 + 4 * q)), 1, 1);
			}
		}
	};
}
