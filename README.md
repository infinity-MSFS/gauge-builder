# Infinity Gauge Builder

Visual editor for building MSFS 2024 WASM gauge instruments. Design NanoVG-based gauges with a drag-and-drop canvas, bind properties to simulator variables, and export a ready-to-compile Rust crate targeting the [infinity-rs](https://github.com/anthropics/infinity-rs) SDK.

## Stack

- **Frontend:** React + TypeScript + Tailwind CSS + Zustand
- **Backend:** Rust (Tauri v2)
- **Output:** Rust crate (`wasm32-wasip1`) using `msfs` / `msfs_derive` from infinity-rs

## Features

- **Scene graph** with Rect, Circle, Arc, Line, Text, Path, and Group elements
- **Canvas** with pan/zoom, drag-to-move, resize handles, and selection
- **Reference images** — drop images onto the canvas to trace over, with per-image opacity, lock, and visibility controls
- **Variables** — define LVars and AVars, bind element properties to sim data at runtime
- **BoundValue system** — any numeric property can be a literal, LVar, AVar, or RPN expression
- **Inspector** — geometry, style, and binding tabs per element
- **Codegen** — generates `gauge.rs`, `draw.rs`, `vars.rs`, and `Cargo.toml` matching infinity-rs API
- **Build** — codegen-only, `cargo check`, or full `wasm32-wasip1` release build
- **Undo/redo** with keyboard shortcuts
- **Save/load** scenes as RON files

## Getting Started

```bash
bun install

bun tauri dev

bun tauri build
```

Requires [Rust](https://rustup.rs/) and the Tauri v2 CLI prerequisites.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+F` | Fit canvas to viewport |
| `Space + drag` | Pan |
| `Scroll` | Zoom |
| `Delete` | Remove selected element/reference |

## License

MIT
