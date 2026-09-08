import type { ElementKind, PathCmd, PathKind } from "../store/sceneStore";
import { lit, rv } from "./geometry";

/** Circle-to-bezier magic constant. */
const K = 0.5522847498307936;

const move = (x: number, y: number): PathCmd => ({
	type: "MoveTo",
	x: lit(x),
	y: lit(y),
});
const line = (x: number, y: number): PathCmd => ({
	type: "LineTo",
	x: lit(x),
	y: lit(y),
});
const bez = (
	c1x: number,
	c1y: number,
	c2x: number,
	c2y: number,
	x: number,
	y: number,
): PathCmd => ({
	type: "BezierTo",
	c1x: lit(c1x),
	c1y: lit(c1y),
	c2x: lit(c2x),
	c2y: lit(c2y),
	x: lit(x),
	y: lit(y),
});

/**
 * Approximate an arc sweep with cubic segments of at most 90°, matching what
 * NanoVG produces internally so the converted path renders identically.
 */
function arcCommands(
	cx: number,
	cy: number,
	r: number,
	a0: number,
	a1: number,
	ccw: boolean,
	startWithMove: boolean,
): PathCmd[] {
	let sweep = a1 - a0;
	if (!ccw && sweep < 0) sweep += Math.PI * 2;
	if (ccw && sweep > 0) sweep -= Math.PI * 2;
	const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
	const delta = sweep / steps;
	const kappa = (4 / 3) * Math.tan(delta / 4);

	const out: PathCmd[] = [];
	let a = a0;
	let px = cx + Math.cos(a) * r;
	let py = cy + Math.sin(a) * r;
	if (startWithMove) out.push(move(px, py));
	for (let i = 0; i < steps; i++) {
		const b = a + delta;
		const cosA = Math.cos(a);
		const sinA = Math.sin(a);
		const cosB = Math.cos(b);
		const sinB = Math.sin(b);
		const c1x = px - kappa * r * sinA;
		const c1y = py + kappa * r * cosA;
		const nx = cx + cosB * r;
		const ny = cy + sinB * r;
		const c2x = nx + kappa * r * sinB;
		const c2y = ny - kappa * r * cosB;
		out.push(bez(c1x, c1y, c2x, c2y, nx, ny));
		a = b;
		px = nx;
		py = ny;
	}
	return out;
}

/**
 * Turn a primitive into an editable Path so it can be reshaped anchor by
 * anchor. Returns null for kinds that are already paths or make no sense to
 * convert (groups, text).
 */
export function toPathKind(
	kind: ElementKind,
	vars: Map<string, number>,
): PathKind | null {
	switch (kind.type) {
		case "Rect": {
			const x = rv(kind.x, vars);
			const y = rv(kind.y, vars);
			const w = rv(kind.w, vars);
			const h = rv(kind.h, vars);
			const r = Math.min(Math.abs(rv(kind.radius, vars)), Math.abs(w) / 2, Math.abs(h) / 2);
			const commands: PathCmd[] =
				r <= 0
					? [
							move(x, y),
							line(x + w, y),
							line(x + w, y + h),
							line(x, y + h),
							{ type: "ClosePath" },
						]
					: [
							move(x + r, y),
							line(x + w - r, y),
							bez(x + w - r + K * r, y, x + w, y + r - K * r, x + w, y + r),
							line(x + w, y + h - r),
							bez(
								x + w,
								y + h - r + K * r,
								x + w - r + K * r,
								y + h,
								x + w - r,
								y + h,
							),
							line(x + r, y + h),
							bez(x + r - K * r, y + h, x, y + h - r + K * r, x, y + h - r),
							line(x, y + r),
							bez(x, y + r - K * r, x + r - K * r, y, x + r, y),
							{ type: "ClosePath" },
						];
			return { type: "Path", commands, style: kind.style };
		}
		case "Circle": {
			const cx = rv(kind.cx, vars);
			const cy = rv(kind.cy, vars);
			const r = Math.abs(rv(kind.r, vars));
			return {
				type: "Path",
				commands: [
					move(cx + r, cy),
					bez(cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r),
					bez(cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy),
					bez(cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r),
					bez(cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy),
					{ type: "ClosePath" },
				],
				style: kind.style,
			};
		}
		case "Arc": {
			const cx = rv(kind.cx, vars);
			const cy = rv(kind.cy, vars);
			const r = Math.abs(rv(kind.r, vars));
			return {
				type: "Path",
				commands: arcCommands(
					cx,
					cy,
					r,
					rv(kind.a0, vars),
					rv(kind.a1, vars),
					kind.dir === "Ccw",
					true,
				),
				style: kind.style,
			};
		}
		case "Line": {
			return {
				type: "Path",
				commands: [
					move(rv(kind.x1, vars), rv(kind.y1, vars)),
					line(rv(kind.x2, vars), rv(kind.y2, vars)),
				],
				style: kind.style,
			};
		}
		default:
			return null;
	}
}

export const canConvertToPath = (kind: ElementKind): boolean =>
	kind.type === "Rect" ||
	kind.type === "Circle" ||
	kind.type === "Arc" ||
	kind.type === "Line";
