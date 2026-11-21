import { useEffect, useRef, useState } from "react";
import { triggerHaptic } from "../haptics.js";
import "./segmented-control.css";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cx = (...a) => a.filter(Boolean).join(" ");

/**
 * options: [{ value, label, icon?, id?, ariaControls?, ref? }] or [[value, label], ...]
 * variant: "solid" | "glass"   (glass = frosted track; needs something behind it to blur)
 * Press and hold the active segment to turn the thumb into a glass lens, then drag.
 */
export default function SegmentedControl({
  options = [],
  value,
  onChange,
  onPick,
  variant,
  glass = true,
  label,
  ariaLabel,
  role = "radiogroup",
  dataActive,
  compact = false,
  className = "",
}) {
  const rootRef = useRef(null);
  const optRefs = useRef([]);
  const dragRef = useRef(null);
  const [pressed, setPressed] = useState(false);
  const [dragX, setDragX] = useState(null); // px offset while dragging, else null
  const [near, setNear] = useState(null); // segment the thumb is currently over

  const normalized = options.map((o) =>
    Array.isArray(o) ? { value: o[0], label: o[1] } : o,
  );
  const n = Math.max(1, normalized.length);
  const index = Math.max(
    0,
    normalized.findIndex((o) => o.value === value),
  );
  const dragging = dragX !== null;
  const resolvedVariant = variant ?? (glass ? "glass" : "solid");
  const handleSelect = onChange || onPick;
  const isTablist = role === "tablist";

  const select = (k) => {
    if (k === index || !normalized[k]) return;
    triggerHaptic("selection");
    try {
      navigator.vibrate?.(8);
    } catch {}
    handleSelect?.(normalized[k].value);
  };

  const reset = () => {
    dragRef.current = null;
    setPressed(false);
    setDragX(null);
    setNear(null);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const blockVerticalScroll = (e) => {
      if (dragRef.current?.canDrag && e.cancelable) {
        e.preventDefault();
      }
    };
    root.addEventListener("touchmove", blockVerticalScroll, { passive: false });
    return () => {
      root.removeEventListener("touchmove", blockVerticalScroll);
    };
  }, []);

  const onPointerDown = (e) => {
    if (e.button) return;
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(root).paddingLeft) || 4;
    const w = (r.width - pad * 2) / n;
    const rel = e.clientX - r.left - pad;
    const canDrag = clamp(Math.floor(rel / w), 0, n - 1) === index; // only the active thumb is draggable
    dragRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      w,
      pad,
      left: r.left,
      moved: false,
      cancelled: false,
      canDrag,
      x: index * w,
      pointerId: e.pointerId,
    };
    if (canDrag) {
      setPressed(true);
      try {
        root.setPointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || d.cancelled || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;

    if (!d.canDrag) {
      if (Math.hypot(dx, dy) > 12) d.cancelled = true;
      return;
    }

    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    d.x = clamp(index * d.w + dx, 0, (n - 1) * d.w);
    setDragX(d.x);
    setNear(Math.round(d.x / d.w));
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    try {
      if (rootRef.current?.hasPointerCapture?.(d.pointerId)) {
        rootRef.current.releasePointerCapture(d.pointerId);
      }
    } catch {}
    if (d.cancelled) {
      reset();
      return;
    }
    const k = d.moved
      ? Math.round(d.x / d.w)
      : Math.floor((e.clientX - d.left - d.pad) / d.w);
    reset();
    select(clamp(k, 0, n - 1));
  };

  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      e.key
    ];
    if (step) {
      e.preventDefault();
      const k = clamp(index + step, 0, n - 1);
      select(k);
      optRefs.current[k]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      select(0);
      optRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      select(n - 1);
      optRefs.current[n - 1]?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role={role}
      aria-label={label || ariaLabel}
      data-active={dataActive ?? String(value ?? "")}
      className={cx(
        "seg",
        "seg-ctrl",
        resolvedVariant === "glass" && "seg--glass",
        pressed && "seg--pressed",
        dragging && "seg--dragging",
        compact && "seg--compact",
        className,
      )}
      style={{ "--seg-n": n }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onPointerLeave={() => {
        if (dragRef.current && !dragRef.current.canDrag) reset();
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="seg__thumb"
        aria-hidden="true"
        style={{
          transform: dragging
            ? `translateX(${dragX}px)`
            : `translateX(${index * 100}%)`,
        }}
      />
      {normalized.map((o, k) => {
        const isActive = k === index;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              optRefs.current[k] = el;
              if (typeof o.ref === "function") o.ref(el);
              else if (o.ref && typeof o.ref === "object") o.ref.current = el;
            }}
            id={o.id}
            type="button"
            role={isTablist ? "tab" : "radio"}
            aria-controls={o.ariaControls}
            aria-selected={isTablist ? isActive : undefined}
            aria-checked={!isTablist ? isActive : undefined}
            tabIndex={isActive ? 0 : -1}
            className={cx(
              "seg__opt",
              near === k && "seg__opt--near",
            )}
            // pointer selection is handled on pointerup; this covers Enter/Space
            onClick={(e) => {
              if (e.detail === 0) select(k);
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
