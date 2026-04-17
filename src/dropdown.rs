use leptos::ev;
use leptos::html::{Button, Div};
use leptos::portal::Portal;
use leptos::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{KeyboardEvent, MouseEvent};

fn cx(parts: &[Option<&str>]) -> String {
    parts.iter().filter_map(|&p| p).collect::<Vec<_>>().join(" ")
}

#[derive(Clone, PartialEq)]
pub struct DropdownOption {
    pub value: String,
    pub label: String,
    pub disabled: bool,
}

impl DropdownOption {
    pub fn new(value: impl Into<String>, label: impl Into<String>) -> Self {
        Self { value: value.into(), label: label.into(), disabled: false }
    }
    pub fn disabled(mut self) -> Self {
        self.disabled = true;
        self
    }
}

#[derive(Clone)]
pub struct PillStyle {
    pub bg: String,
    pub color: String,
}

#[derive(Clone, Copy, PartialEq)]
struct MenuPos {
    top: f64,
    left: f64,
    width: f64,
    place_above: bool,
}

#[component]
pub fn Dropdown(
    /// The currently selected value.
    #[prop(into)]
    value: Signal<String>,
    /// Called when the user selects a new option.
    on_change: Callback<String>,
    /// The list of options to display.
    options: Vec<DropdownOption>,
    #[prop(default = "Select…".into())] placeholder: String,
    #[prop(default = false)] disabled: bool,
    #[prop(optional)] class: Option<String>,
    /// Compact pill style for inline use (e.g. mode selectors).
    #[prop(default = false)]
    compact: bool,
    /// Custom bg/text for compact pill mode.
    #[prop(optional)]
    pill_style: Option<PillStyle>,
) -> impl IntoView {
    let open = RwSignal::new(false);
    let root_ref = NodeRef::<Div>::new();
    let button_ref = NodeRef::<Button>::new();
    let menu_pos: RwSignal<Option<MenuPos>> = RwSignal::new(None);

    let options = StoredValue::new(options);
    let placeholder = StoredValue::new(placeholder);

    let selected = Memo::new(move |_| {
        let v = value.get();
        options.with_value(|opts| opts.iter().find(|o| o.value == v).cloned())
    });

    let selected_label =
        move || selected.get().map(|s| s.label).unwrap_or_else(|| placeholder.with_value(|p| p.clone()));

    let enabled_options = Memo::new(move |_| {
        options.with_value(|opts| opts.iter().filter(|o| !o.disabled).cloned().collect::<Vec<_>>())
    });

    let select_value = move |v: String| {
        if disabled {
            return;
        }
        on_change.run(v);
        open.set(false);
        if let Some(btn) = button_ref.get() {
            let _ = btn.focus();
        }
    };

    // ── Close on outside click ───────────────────────────────────────
    let ml = window_event_listener(ev::mousedown, move |e: MouseEvent| {
        let Some(target) = e.target().and_then(|t| t.dyn_into::<web_sys::Element>().ok()) else {
            return;
        };
        if let Some(root) = root_ref.get_untracked() {
            if root.contains(Some(target.unchecked_ref())) {
                return;
            }
        }
        if target.closest("[data-dropdown-portal]").ok().flatten().is_some() {
            return;
        }
        open.set(false);
    });
    on_cleanup(move || drop(ml));

    // ── Close on Escape ──────────────────────────────────────────────
    let kl = window_event_listener(ev::keydown, move |e: KeyboardEvent| {
        if e.key() == "Escape" {
            open.set(false);
        }
    });
    on_cleanup(move || drop(kl));

    // ── Compute portal position when menu opens ──────────────────────
    let compute_pos = move || {
        let Some(btn) = button_ref.get_untracked() else { return };
        let r = btn.get_bounding_client_rect();
        let viewport_h = web_sys::window()
            .and_then(|w| w.inner_height().ok())
            .and_then(|v| v.as_f64())
            .unwrap_or(600.0);
        let approx_menu_h = if compact { 220.0_f64 } else { 256.0_f64 };
        let space_below = viewport_h - r.bottom();
        let place_above = space_below < approx_menu_h && r.top() > space_below;
        menu_pos.set(Some(MenuPos {
            top: if place_above { r.top() } else { r.bottom() },
            left: r.left(),
            width: r.width(),
            place_above,
        }));
    };

    Effect::new(move |_| {
        if open.get() {
            compute_pos();
        } else {
            menu_pos.set(None);
        }
    });

    // ── Keyboard navigation ──────────────────────────────────────────
    let on_button_keydown = move |e: KeyboardEvent| {
        if disabled {
            return;
        }
        let key = e.key();
        let is_open = open.get_untracked();
        if !is_open {
            if key == "Enter" || key == " " || key == "ArrowDown" {
                e.prevent_default();
                open.set(true);
            }
            return;
        }
        if key == "Escape" {
            e.prevent_default();
            open.set(false);
            return;
        }
        if key != "ArrowDown" && key != "ArrowUp" {
            return;
        }
        e.prevent_default();
        let opts = enabled_options.get_untracked();
        if opts.is_empty() {
            return;
        }
        let cur_val = value.get_untracked();
        let cur_idx = opts.iter().position(|o| o.value == cur_val).unwrap_or(0);
        let next_idx = if key == "ArrowDown" {
            (cur_idx + 1).min(opts.len() - 1)
        } else {
            cur_idx.saturating_sub(1)
        };
        if let Some(next) = opts.get(next_idx) {
            select_value(next.value.clone());
        }
    };

    let pill_bg =
        pill_style.as_ref().map(|p| p.bg.clone()).unwrap_or_else(|| "#111111".into());
    let pill_color =
        pill_style.as_ref().map(|p| p.color.clone()).unwrap_or_else(|| "#a0a0a0".into());

    // Pre-compute the portal position style reactively so it can be used as Fn
    let portal_style = Signal::derive(move || {
        let Some(pos) = menu_pos.get() else {
            return String::new();
        };
        let transform = if pos.place_above {
            "translateY(-6px) translateY(-100%)"
        } else {
            "translateY(6px)"
        };
        let width = if compact { pos.width.max(100.0) } else { pos.width };
        format!(
            "position:fixed;z-index:9999;left:{left}px;width:{width}px;top:{top}px;transform:{transform};",
            left = pos.left,
            top = pos.top,
        )
    });

    // ── Compact pill mode ────────────────────────────────────────────
    if compact {
        let class_str = cx(&[Some("relative inline-block shrink-0"), class.as_deref()]);
        return view! {
            <div node_ref=root_ref class=class_str>
                <button
                    node_ref=button_ref
                    type="button"
                    disabled=disabled
                    on:click=move |_| { if !disabled { open.update(|v| *v = !*v); } }
                    on:keydown=on_button_keydown
                    class="inline-flex items-center gap-0.5 text-[10px] font-bold rounded-md px-1.5 py-1 outline-none cursor-pointer"
                    style=move || format!("background:{};color:{};", pill_bg, pill_color)
                    aria-haspopup="listbox"
                    aria-expanded=move || open.get().to_string()
                >
                    {selected_label}
                    // ChevronDown
                    <svg
                        class=move || cx(&[
                            Some("h-2.5 w-2.5 shrink-0 transition-transform opacity-60"),
                            if open.get() { Some("rotate-180") } else { None },
                        ])
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <polyline points="6 9 12 15 18 9" />
                    </svg>
                </button>

                {move || {
                    if !open.get() { return None; }
                    menu_pos.get()?;
                    Some(view! {
                        <Portal>
                            <div data-dropdown-portal="" style=portal_style>
                                <div
                                    class="overflow-hidden rounded-lg"
                                    style="background:#0a0a0a;border:1px solid #1e1e1e;box-shadow:0 8px 32px rgba(0,0,0,0.8);"
                                >
                                    <div class="overflow-y-auto" style="max-height:220px;">
                                        {options.with_value(|opts| opts.iter().map(|opt| {
                                            let opt = opt.clone();
                                            let val_click = opt.value.clone();
                                            let val_sel = opt.value.clone();
                                            let is_sel = Signal::derive(move || value.get() == val_sel);
                                            view! {
                                                <button
                                                    type="button"
                                                    disabled=opt.disabled
                                                    on:click=move |_| {
                                                        if !opt.disabled { select_value(val_click.clone()); }
                                                    }
                                                    class=move || cx(&[
                                                        Some("w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors"),
                                                        if !is_sel.get() { Some("hover:bg-white/5") } else { None },
                                                    ])
                                                    style=move || format!(
                                                        "background:{};color:{};border-bottom:1px solid #111111;opacity:{};cursor:{};",
                                                        if is_sel.get() { "rgba(99,102,241,0.12)" } else { "transparent" },
                                                        if is_sel.get() { "#818cf8" } else { "#a0a0a0" },
                                                        if opt.disabled { "0.4" } else { "1" },
                                                        if opt.disabled { "not-allowed" } else { "pointer" },
                                                    )
                                                >
                                                    <span>{opt.label.clone()}</span>
                                                    // Check
                                                    {move || is_sel.get().then(|| view! {
                                                        <svg
                                                            class="h-3 w-3 shrink-0"
                                                            style="color:#818cf8;"
                                                            xmlns="http://www.w3.org/2000/svg"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="2"
                                                            stroke-linecap="round"
                                                            stroke-linejoin="round"
                                                        >
                                                            <polyline points="20 6 9 20 4 15" />
                                                        </svg>
                                                    })}
                                                </button>
                                            }
                                        }).collect_view())}
                                    </div>
                                </div>
                            </div>
                        </Portal>
                    })
                }}
            </div>
        }
        .into_any();
    }

    // ── Standard mode ────────────────────────────────────────────────
    let class_str = cx(&[Some("relative w-full"), class.as_deref()]);
    view! {
        <div node_ref=root_ref class=class_str>
            <button
                node_ref=button_ref
                type="button"
                disabled=disabled
                on:click=move |_| { if !disabled { open.update(|v| *v = !*v); } }
                on:keydown=on_button_keydown
                class=move || cx(&[
                    Some("w-full inline-flex items-center justify-between gap-2 rounded-md text-xs outline-none transition-colors cursor-pointer px-2.5 py-1.5"),
                    if disabled { Some("opacity-50 cursor-not-allowed") } else { None },
                ])
                style=move || format!(
                    "background:#0f0f0f;border:1px solid {};color:{};",
                    if open.get() { "#6366f1" } else { "#181818" },
                    if selected.get().is_some() { "#e8e8e8" } else { "#737373" },
                )
                aria-haspopup="listbox"
                aria-expanded=move || open.get().to_string()
            >
                <span class="min-w-0 truncate">{selected_label}</span>
                // ChevronDown
                <svg
                    class=move || cx(&[
                        Some("h-3.5 w-3.5 shrink-0 transition-transform"),
                        if open.get() { Some("rotate-180") } else { None },
                    ])
                    style="color:#454545;"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {move || {
                if !open.get() { return None; }
                menu_pos.get()?;
                Some(view! {
                    <Portal>
                        <div data-dropdown-portal="" style=portal_style>
                            <div
                                class="overflow-hidden rounded-lg"
                                style="background:#0a0a0a;border:1px solid #1e1e1e;box-shadow:0 12px 40px rgba(0,0,0,0.9);"
                            >
                                <div class="overflow-y-auto" style="max-height:256px;">
                                    {options.with_value(|opts| opts.iter().map(|opt| {
                                        let opt = opt.clone();
                                        let val_click = opt.value.clone();
                                        let val_sel = opt.value.clone();
                                        let is_sel = Signal::derive(move || value.get() == val_sel);
                                        view! {
                                            <button
                                                type="button"
                                                disabled=opt.disabled
                                                on:click=move |_| {
                                                    if !opt.disabled { select_value(val_click.clone()); }
                                                }
                                                class=move || cx(&[
                                                    Some("w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors"),
                                                    if !is_sel.get() { Some("hover:bg-white/5") } else { None },
                                                ])
                                                style=move || format!(
                                                    "background:{};color:{};border-bottom:1px solid #111111;opacity:{};cursor:{};",
                                                    if is_sel.get() { "rgba(99,102,241,0.12)" } else { "transparent" },
                                                    if is_sel.get() { "#818cf8" } else { "#c0c0c0" },
                                                    if opt.disabled { "0.4" } else { "1" },
                                                    if opt.disabled { "not-allowed" } else { "pointer" },
                                                )
                                            >
                                                <span class="min-w-0 truncate">{opt.label.clone()}</span>
                                                // Check
                                                {move || is_sel.get().then(|| view! {
                                                    <svg
                                                        class="h-3.5 w-3.5 shrink-0"
                                                        style="color:#818cf8;"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    >
                                                        <polyline points="20 6 9 20 4 15" />
                                                    </svg>
                                                })}
                                            </button>
                                        }
                                    }).collect_view())}
                                </div>
                            </div>
                        </div>
                    </Portal>
                })
            }}
        </div>
    }
    .into_any()
}
