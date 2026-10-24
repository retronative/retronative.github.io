// The hero laptop: a photograph (public/hero/laptop-*.webp, cut out by
// scripts/cut-hero-laptop.mjs) with the game on a plane mapped onto its display.
//
// Coordinates are in the photo's pixels. The page works in cqw of the figure, so the
// plane is placed with CSS functions that take lengths (translate, perspective) and
// unitless matrices, and scales with the image at every width, without JS.

/** The published image's canvas, tight around the laptop; the photo (2000 × 1500) sits at PHOTO.left, PHOTO.top. */
export const IMAGE = { width: 1780, height: 1600 };
export const PHOTO = { left: -110, top: 30 };
/** The display's corners in the photo, measured on its bezel edges: top left, top right, bottom right, bottom left. */
export const DISPLAY = {
	corners: [
		[304.3, 33],
		[1707.4, 33],
		[1697.6, 937.5],
		[318.1, 937.5],
	] as const,
	/** 2560 × 1664 panel. */
	aspect: 2560 / 1664,
	/** Top corner radius, as a fraction of the display's width. */
	radius: 0.0105,
	/** The camera housing, as fractions of the display: left and right edges, depth, and corner radius (of the width). */
	notch: { left: 0.4417, right: 0.5586, depth: 0.0348, radius: 0.0062 },
};

/** The plane's width and height, in cqw. */
export const PLANE = { w: 70, h: 70 / DISPLAY.aspect };

/**
 * The plane's CSS transform (transform-origin 0 0, placed at the image's top left):
 * the homography from the plane onto the display quad, split into an affine part and
 * a pure projective part that perspective() reproduces after a small rotation.
 */
export function displayTransform() {
	const k = 100 / IMAGE.width; // image px -> cqw
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = DISPLAY.corners.map(([x, y]) => [(x + PHOTO.left) * k, (y + PHOTO.top) * k]);
	// Unit square -> quad (Heckbert).
	const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
	const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
	const den = dx1 * dy2 - dx2 * dy1;
	const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
	const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
	// In the plane's own units (u = x / w, v = y / h): H = [B t; v 1].
	const B = [a / PLANE.w, b / PLANE.h, d / PLANE.w, e / PLANE.h];
	const v = [g / PLANE.w, h / PLANE.h];
	// H = [L t; 0 1] · [I 0; v 1], with L = B - t v.
	const L = [B[0] - x0 * v[0], B[1] - x0 * v[1], B[2] - y0 * v[0], B[3] - y0 * v[1]];
	// [I 0; v 1] = R₂⁻¹ · perspective(D) · R, for R a rotation by α about an axis in the plane
	// (R₂ is R's top-left 2 × 2, folded into L).
	const n = Math.hypot(v[0], v[1]);
	const alpha = (20 * Math.PI) / 180;
	const D = Math.sin(alpha) / n;
	const ax = -v[1] / n, ay = v[0] / n, c = Math.cos(alpha), s = Math.sin(alpha), t = 1 - c;
	const R = [
		[c + t * ax * ax, t * ax * ay, s * ay],
		[t * ax * ay, c + t * ay * ay, -s * ax],
		[-s * ay, s * ax, c],
	];
	const det = R[0][0] * R[1][1] - R[0][1] * R[1][0];
	const Ri = [R[1][1] / det, -R[0][1] / det, -R[1][0] / det, R[0][0] / det];
	const M = [L[0] * Ri[0] + L[1] * Ri[2], L[0] * Ri[1] + L[1] * Ri[3], L[2] * Ri[0] + L[3] * Ri[2], L[2] * Ri[1] + L[3] * Ri[3]];
	const f = (x: number) => +x.toFixed(6);
	return [
		`translate(${f(x0)}cqw, ${f(y0)}cqw)`,
		`matrix(${f(M[0])}, ${f(M[2])}, ${f(M[1])}, ${f(M[3])}, 0, 0)`,
		`perspective(${f(D)}cqw)`,
		`matrix3d(${[R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, 0, 0, 0, 1].map(f).join(', ')})`,
	].join(' ');
}
