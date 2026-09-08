import type {
	BoundColor,
	ElementKind,
	NvgStyle,
	SceneElement,
} from "../store/sceneStore";
import { rv, textOf } from "./geometry";

export function colorToCSS(c: BoundColor | null): string | null {
	if (!c) return null;
	const [r, g, b, a] = c.Rgba;
	return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

function applyStyle(ctx: CanvasRenderingContext2D, style: NvgStyle) {
	const fill = colorToCSS(style.fill);
	const stroke = colorToCSS(style.stroke);
	if (fill) ctx.fillStyle = fill;
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = style.stroke_width;
	}
	ctx.lineCap = style.line_cap.toLowerCase() as CanvasLineCap;
	ctx.lineJoin = style.line_join.toLowerCase() as CanvasLineJoin;
}

export interface RenderOpts {
	/** Live geometry for elements mid-drag, keyed by id. */
	overrides?: Map<string, ElementKind>;
	/** Draw stroked outlines only, ignoring fills (outline preview mode). */
	outlineOnly?: boolean;
}

function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
) {
	const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
	ctx.beginPath();
	if (rr <= 0) {
		ctx.rect(x, y, w, h);
	} else {
		ctx.roundRect(x, y, w, h, rr);
	}
}

export function drawElement(
	ctx: CanvasRenderingContext2D,
	el: SceneElement,
	vars: Map<string, number>,
	opts: RenderOpts = {},
) {
	if (!el.visible) return;
	const k = opts.overrides?.get(el.id) ?? el.kind;
	const outline = opts.outlineOnly === true;

	const doFill = (style: NvgStyle) => !outline && !!style.fill;
	const doStroke = (style: NvgStyle) => !!style.stroke || outline;
	const prepOutline = (style: NvgStyle) => {
		if (!outline) return;
		ctx.strokeStyle = style.stroke ? colorToCSS(style.stroke)! : "#8b8b8b";
		ctx.lineWidth = 1 / (ctx.getTransform().a || 1);
	};

	ctx.save();
	switch (k.type) {
		case "Rect": {
			applyStyle(ctx, k.style);
			prepOutline(k.style);
			const x = rv(k.x, vars),
				y = rv(k.y, vars),
				w = rv(k.w, vars),
				h = rv(k.h, vars);
			roundRectPath(ctx, x, y, w, h, rv(k.radius, vars));
			if (doFill(k.style)) ctx.fill();
			if (doStroke(k.style)) ctx.stroke();
			break;
		}
		case "Circle": {
			applyStyle(ctx, k.style);
			prepOutline(k.style);
			ctx.beginPath();
			ctx.arc(
				rv(k.cx, vars),
				rv(k.cy, vars),
				Math.max(0, rv(k.r, vars)),
				0,
				Math.PI * 2,
			);
			if (doFill(k.style)) ctx.fill();
			if (doStroke(k.style)) ctx.stroke();
			break;
		}
		case "Arc": {
			applyStyle(ctx, k.style);
			prepOutline(k.style);
			ctx.beginPath();
			ctx.arc(
				rv(k.cx, vars),
				rv(k.cy, vars),
				Math.max(0, rv(k.r, vars)),
				rv(k.a0, vars),
				rv(k.a1, vars),
				k.dir === "Ccw",
			);
			if (doFill(k.style)) ctx.fill();
			if (doStroke(k.style)) ctx.stroke();
			break;
		}
		case "Line": {
			applyStyle(ctx, k.style);
			prepOutline(k.style);
			ctx.beginPath();
			ctx.moveTo(rv(k.x1, vars), rv(k.y1, vars));
			ctx.lineTo(rv(k.x2, vars), rv(k.y2, vars));
			ctx.stroke();
			break;
		}
		case "Text": {
			applyStyle(ctx, k.style);
			const x = rv(k.x, vars),
				y = rv(k.y, vars),
				fs = rv(k.font_size, vars);
			ctx.font = `${fs}px ${k.font || "sans-serif"}`;
			ctx.textAlign =
				k.align_h === "Center" ? "center" : k.align_h === "Right" ? "right" : "left";
			ctx.textBaseline =
				k.align_v === "Top"
					? "top"
					: k.align_v === "Middle"
						? "middle"
						: k.align_v === "Bottom"
							? "bottom"
							: "alphabetic";
			const content = textOf(k, vars);
			if (outline) {
				ctx.strokeStyle = "#8b8b8b";
				ctx.lineWidth = 1 / (ctx.getTransform().a || 1);
				ctx.strokeText(content, x, y);
			} else {
				if (k.style.fill) ctx.fillText(content, x, y);
				if (k.style.stroke) ctx.strokeText(content, x, y);
			}
			break;
		}
		case "Path": {
			applyStyle(ctx, k.style);
			prepOutline(k.style);
			ctx.beginPath();
			for (const cmd of k.commands) {
				switch (cmd.type) {
					case "MoveTo":
						ctx.moveTo(rv(cmd.x, vars), rv(cmd.y, vars));
						break;
					case "LineTo":
						ctx.lineTo(rv(cmd.x, vars), rv(cmd.y, vars));
						break;
					case "BezierTo":
						ctx.bezierCurveTo(
							rv(cmd.c1x, vars),
							rv(cmd.c1y, vars),
							rv(cmd.c2x, vars),
							rv(cmd.c2y, vars),
							rv(cmd.x, vars),
							rv(cmd.y, vars),
						);
						break;
					case "ClosePath":
						ctx.closePath();
						break;
				}
			}
			if (doFill(k.style)) ctx.fill();
			if (doStroke(k.style)) ctx.stroke();
			break;
		}
		case "Group": {
			const opacity = rv(k.opacity, vars);
			const tx = rv(k.translate_x, vars);
			const ty = rv(k.translate_y, vars);
			const rot = rv(k.rotate, vars);
			const sx = rv(k.scale_x, vars);
			const sy = rv(k.scale_y, vars);
			const px = rv(k.pivot_x, vars);
			const py = rv(k.pivot_y, vars);

			const drawChildren = () => {
				for (const child of k.children) drawElement(ctx, child, vars, opts);
			};

			const drawWithClip = () => {
				if (k.clip_modifier) {
					ctx.save();
					ctx.beginPath();
					ctx.rect(
						rv(k.clip_modifier.x, vars),
						rv(k.clip_modifier.y, vars),
						rv(k.clip_modifier.w, vars),
						rv(k.clip_modifier.h, vars),
					);
					ctx.clip();
					drawChildren();
					ctx.restore();
				} else {
					drawChildren();
				}
			};

			// Group transform applied once — moving the parent slides the whole
			// array without deforming its instances.
			ctx.translate(tx + px, ty + py);
			ctx.rotate((rot * Math.PI) / 180);
			ctx.scale(sx, sy);
			ctx.translate(-px, -py);
			ctx.globalAlpha *= opacity;

			if (!k.array_modifier) {
				drawWithClip();
			} else if (k.array_modifier.type === "Linear") {
				const ox = rv(k.array_modifier.offset_x, vars);
				const oy = rv(k.array_modifier.offset_y, vars);
				for (let i = 0; i < k.array_modifier.count; i++) {
					ctx.save();
					ctx.translate(i * ox, i * oy);
					drawWithClip();
					ctx.restore();
				}
			} else {
				const am = k.array_modifier;
				const icx = rv(am.cx, vars);
				const icy = rv(am.cy, vars);
				const saDeg = rv(am.start_angle, vars);
				const aaDeg = rv(am.arc_angle, vars);
				const step = (aaDeg / am.count) * (Math.PI / 180);
				const saRad = saDeg * (Math.PI / 180);
				for (let i = 0; i < am.count; i++) {
					const angle = saRad + i * step;
					ctx.save();
					ctx.translate(icx, icy);
					ctx.rotate(angle);
					ctx.translate(-icx, -icy);
					drawWithClip();
					ctx.restore();
				}
			}
			break;
		}
	}
	ctx.restore();
}
