import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type DropdownOption = { value: string; label: string; disabled?: boolean };

type DropdownProps = {
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Compact pill style for inline use (e.g. mode selectors) */
  compact?: boolean;
  /** Custom bg/text for compact pill mode */
  pillStyle?: { bg: string; color: string };
};

export const Dropdown: FC<DropdownProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  className,
  compact = false,
  pillStyle,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    placeAbove: boolean;
  } | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const selectedLabel = selected?.label ?? placeholder;
  const enabledOptions = useMemo(() => options.filter((o) => !o.disabled), [options]);

  const selectValue = (v: string) => {
    if (disabled) return;
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Close on outside click / Escape
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as HTMLElement;
      if (root.contains(t)) return;
      if (t.closest?.("[data-dropdown-portal]")) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Compute portal position on open
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const viewportH = window.innerHeight;
      const approxMenuH = 256;
      const spaceBelow = viewportH - r.bottom;
      const placeAbove = spaceBelow < approxMenuH && r.top > spaceBelow;
      setMenuPos({ top: placeAbove ? r.top : r.bottom, left: r.left, width: r.width, placeAbove });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Keyboard nav
  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (enabledOptions.length === 0) return;
    const currentIdx = enabledOptions.findIndex((o) => o.value === value);
    const idx = currentIdx === -1 ? 0 : currentIdx;
    const nextIdx = e.key === "ArrowDown"
      ? Math.min(enabledOptions.length - 1, idx + 1)
      : Math.max(0, idx - 1);
    const next = enabledOptions[nextIdx];
    if (next) selectValue(next.value);
  };

  // ── Compact pill mode (for mode selectors) ─────────────────────────
  if (compact) {
    const bg = pillStyle?.bg ?? "#111111";
    const color = pillStyle?.color ?? "#a0a0a0";
    return (
      <div ref={rootRef} className={cx("relative inline-block shrink-0", className)}>
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          onKeyDown={onButtonKeyDown}
          className="inline-flex items-center gap-0.5 text-[10px] font-bold rounded-md px-1.5 py-1 outline-none cursor-pointer"
          style={{ background: bg, color }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {selectedLabel}
          <ChevronDown
            className={cx("h-2.5 w-2.5 shrink-0 transition-transform opacity-60", open && "rotate-180")}
          />
        </button>
        {open && menuPos
          ? createPortal(
              <div
                data-dropdown-portal
                className="fixed z-[9999]"
                style={{
                  left: menuPos.left,
                  width: Math.max(menuPos.width, 100),
                  top: menuPos.top,
                  transform: menuPos.placeAbove ? "translateY(-6px) translateY(-100%)" : "translateY(6px)",
                }}
              >
                <div
                  className="overflow-hidden rounded-lg"
                  style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", boxShadow: "0 8px 32px rgba(0,0,0,0.8)" }}
                >
                  <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                    {options.map((opt) => {
                      const isSelected = opt.value === value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={!!opt.disabled}
                          onClick={() => !opt.disabled && selectValue(opt.value)}
                          className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors"
                          style={{
                            background: isSelected ? "rgba(99,102,241,0.12)" : "transparent",
                            color: isSelected ? "#818cf8" : "#a0a0a0",
                            borderBottom: "1px solid #111111",
                            opacity: opt.disabled ? 0.4 : 1,
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                          }}
                        >
                          <span>{opt.label}</span>
                          {isSelected && <Check className="h-3 w-3 text-indigo-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }

  // ── Standard mode ───────────────────────────────────────────────────
  return (
    <div ref={rootRef} className={cx("relative w-full", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        className={cx(
          "w-full inline-flex items-center justify-between gap-2 rounded-md text-xs outline-none transition-colors cursor-pointer",
          "px-2.5 py-1.5",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        style={{
          background: "#0f0f0f",
          border: `1px solid ${open ? "#6366f1" : "#181818"}`,
          color: selected ? "#e8e8e8" : "#737373",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          className={cx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
          style={{ color: "#454545" }}
        />
      </button>

      {open && menuPos
        ? createPortal(
            <div
              data-dropdown-portal
              className="fixed z-[9999]"
              style={{
                left: menuPos.left,
                width: menuPos.width,
                top: menuPos.top,
                transform: menuPos.placeAbove ? "translateY(-6px) translateY(-100%)" : "translateY(6px)",
              }}
            >
              <div
                className="overflow-hidden rounded-lg"
                style={{ background: "#0a0a0a", border: "1px solid #1e1e1e", boxShadow: "0 12px 40px rgba(0,0,0,0.9)" }}
              >
                <div className="overflow-y-auto" style={{ maxHeight: 256 }}>
                  {options.map((opt) => {
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={!!opt.disabled}
                        onClick={() => !opt.disabled && selectValue(opt.value)}
                        className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors"
                        style={{
                          background: isSelected ? "rgba(99,102,241,0.12)" : "transparent",
                          color: isSelected ? "#818cf8" : "#c0c0c0",
                          borderBottom: "1px solid #111111",
                          opacity: opt.disabled ? 0.4 : 1,
                          cursor: opt.disabled ? "not-allowed" : "pointer",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        <span className="min-w-0 truncate">{opt.label}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
