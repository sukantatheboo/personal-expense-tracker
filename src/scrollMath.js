/**
 * Pure scroll-linked math for the collapsing header and optional bottom dock hide-on-scroll.
 * Kept free of DOM/React dependencies so it can be unit-tested directly under Node.
 */

export function clamp(value, min = 0, max = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

/**
 * Derive scroll start and end offsets (px) from the measured large header height.
 * Start is ~20px (or 35% of height if shorter), end is the measured header height.
 */
export function computeHeaderScrollRange(measuredHeight) {
  const numericHeight = Number(measuredHeight);
  const end =
    Number.isFinite(numericHeight) && numericHeight > 0
      ? Math.max(44, Math.round(numericHeight))
      : 64;
  const start = Math.round(Math.min(20, end * 0.35));
  return { start, end };
}

/**
 * Compute normalized scroll progress p in [0, 1].
 * p = clamp((scrollTop - start) / (end - start), 0, 1)
 */
export function computeScrollProgress(scrollTop, start, end) {
  const span = Number(end) - Number(start);
  if (!Number.isFinite(span) || span <= 0) {
    return (Number(scrollTop) || 0) >= (Number(end) || 0) ? 1 : 0;
  }
  return clamp(((Number(scrollTop) || 0) - (Number(start) || 0)) / span, 0, 1);
}

/**
 * Compute non-overlapping opacity curves and compact title settle offset from progress p.
 * - Large header block: clamp(0, 1 - p * 2, 1)       -> 1..0 over p in [0, 0.5]
 * - Compact title:      clamp(0, (p - 0.5) * 2, 1)   -> 0..1 over p in [0.5, 1]
 * - Compact bar bg/hairline: p                       -> 0..1 over p in [0, 1]
 * - Compact title translateY: (1 - compactOpacity) * 5px -> 5px..0px as it appears
 *
 * At p = 0.5 both titles are 0 so they never overlap or ghost.
 */
export function computeHeaderOpacities(p) {
  const progress = clamp(p, 0, 1);
  const largeOpacity = clamp(1 - progress * 2, 0, 1);
  const compactOpacity = clamp((progress - 0.5) * 2, 0, 1);
  const barOpacity = progress;
  const compactTranslateY = (1 - compactOpacity) * 5;
  return {
    p: progress,
    largeOpacity,
    compactOpacity,
    barOpacity,
    compactTranslateY,
  };
}

export const DOCK_SCROLL_DEFAULTS = {
  hideThreshold: 24,
  showThreshold: 12,
  topPinThreshold: 24,
  bottomPinThreshold: 24,
};

export function createDockScrollState(initialScrollTop = 0) {
  return {
    hidden: false,
    lastScrollTop: Math.max(0, Number(initialScrollTop) || 0),
    accumulatedDelta: 0,
    direction: 0, // 1 = down, -1 = up, 0 = neutral
  };
}

/**
 * Pure directional accumulator for hiding the bottom dock on scroll down
 * and revealing it on scroll up.
 * - Always visible when scrollTop < topPinThreshold (24px)
 * - Always visible when near the bottom of the scroll container
 * - Hides after accumulating >= hideThreshold (24px) downward
 * - Shows after accumulating >= showThreshold (12px) upward
 */
export function stepDockScrollVisibility(
  prevState,
  metrics,
  options = DOCK_SCROLL_DEFAULTS,
) {
  const cfg = { ...DOCK_SCROLL_DEFAULTS, ...options };
  const state = prevState || createDockScrollState(0);
  const scrollTop = Math.max(0, Number(metrics?.scrollTop) || 0);
  const scrollHeight = Math.max(0, Number(metrics?.scrollHeight) || 0);
  const clientHeight = Math.max(0, Number(metrics?.clientHeight) || 0);

  const isNearTop = scrollTop < cfg.topPinThreshold;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const isNearBottom =
    scrollHeight > 0 &&
    clientHeight > 0 &&
    (maxScroll <= cfg.bottomPinThreshold ||
      scrollTop >= maxScroll - cfg.bottomPinThreshold);

  if (isNearTop || isNearBottom) {
    return {
      hidden: false,
      lastScrollTop: scrollTop,
      accumulatedDelta: 0,
      direction: 0,
    };
  }

  const delta = scrollTop - state.lastScrollTop;
  if (delta === 0) {
    return state;
  }

  if (delta > 0) {
    const accumulatedDelta =
      state.direction === 1 ? state.accumulatedDelta + delta : delta;
    const hidden =
      state.hidden || accumulatedDelta >= cfg.hideThreshold;
    return {
      hidden,
      lastScrollTop: scrollTop,
      accumulatedDelta,
      direction: 1,
    };
  }

  // delta < 0 (scrolling up)
  const upDist = -delta;
  const accumulatedDelta =
    state.direction === -1 ? state.accumulatedDelta + upDist : upDist;
  const hidden =
    state.hidden && accumulatedDelta < cfg.showThreshold;
  return {
    hidden,
    lastScrollTop: scrollTop,
    accumulatedDelta,
    direction: -1,
  };
}
