import test from "node:test";
import assert from "node:assert/strict";
import {
  computeHeaderOpacities,
  computeHeaderScrollRange,
  computeScrollProgress,
  createDockScrollState,
  stepDockScrollVisibility,
} from "../src/scrollMath.js";

test("Header scroll math: non-overlapping opacity curves prevent ghosting", () => {
  const at0 = computeHeaderOpacities(0);
  assert.equal(at0.largeOpacity, 1);
  assert.equal(at0.compactOpacity, 0);
  assert.equal(at0.barOpacity, 0);
  assert.equal(at0.compactTranslateY, 5);

  // At p = 0.25 only the large title is visible
  const at25 = computeHeaderOpacities(0.25);
  assert.equal(at25.largeOpacity, 0.5);
  assert.equal(at25.compactOpacity, 0);

  // At p = 0.5 neither title is above 0.01
  const at50 = computeHeaderOpacities(0.5);
  assert.ok(at50.largeOpacity <= 0.01, `expected largeOpacity <= 0.01, got ${at50.largeOpacity}`);
  assert.ok(at50.compactOpacity <= 0.01, `expected compactOpacity <= 0.01, got ${at50.compactOpacity}`);

  // At p = 0.75 only the compact title is visible
  const at75 = computeHeaderOpacities(0.75);
  assert.equal(at75.largeOpacity, 0);
  assert.equal(at75.compactOpacity, 0.5);

  const at100 = computeHeaderOpacities(1);
  assert.equal(at100.largeOpacity, 0);
  assert.equal(at100.compactOpacity, 1);
  assert.equal(at100.barOpacity, 1);
  assert.equal(at100.compactTranslateY, 0);

  // At no scroll position are both titles visible simultaneously
  for (let i = 0; i <= 100; i += 1) {
    const { largeOpacity, compactOpacity } = computeHeaderOpacities(i / 100);
    assert.ok(
      !(largeOpacity > 0 && compactOpacity > 0),
      `both titles visible at p=${i / 100}: large=${largeOpacity}, compact=${compactOpacity}`,
    );
  }
});

test("Header scroll progress: derives range from measured height and clamps [0, 1]", () => {
  const { start, end } = computeHeaderScrollRange(64);
  assert.equal(start, 20);
  assert.equal(end, 64);

  assert.equal(computeScrollProgress(0, start, end), 0);
  assert.equal(computeScrollProgress(20, start, end), 0);
  assert.equal(computeScrollProgress(42, start, end), 0.5);
  assert.equal(computeScrollProgress(64, start, end), 1);
  assert.equal(computeScrollProgress(200, start, end), 1);

  // At scrollTop 30..50px only one title is visible at every point
  for (let scrollTop = 30; scrollTop <= 50; scrollTop += 1) {
    const p = computeScrollProgress(scrollTop, start, end);
    const { largeOpacity, compactOpacity } = computeHeaderOpacities(p);
    assert.ok(
      !(largeOpacity > 0 && compactOpacity > 0),
      `overlap at scrollTop=${scrollTop} (p=${p})`,
    );
  }
});

test("Dock direction logic: accumulates 24px down to hide, 12px up to show, pinned at top/bottom", () => {
  const viewport = { scrollHeight: 2000, clientHeight: 800 };
  let state = createDockScrollState(0);

  // Stay visible while scrollTop < 24
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 20 });
  assert.equal(state.hidden, false);

  // Move to scrollTop = 100 (first step past top pin: 80px down >= 24 -> hides)
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 100 });
  assert.equal(state.hidden, true);

  // Small upward scroll (< 12px) keeps dock hidden
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 95 });
  assert.equal(state.hidden, true);
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 89 });
  assert.equal(state.hidden, true); // accumulated 11px up

  // Crossing 12px up reveals the dock
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 88 });
  assert.equal(state.hidden, false);

  // Downward accumulation: 10px + 13px = 23px stays visible, +1px = 24px hides
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 98 });
  assert.equal(state.hidden, false);
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 111 });
  assert.equal(state.hidden, false);
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 112 });
  assert.equal(state.hidden, true);

  // Near the bottom always shows the dock
  state = stepDockScrollVisibility(state, { ...viewport, scrollTop: 1180 });
  assert.equal(state.hidden, false);

  // Returning to top (< 24px) always shows the dock
  state = stepDockScrollVisibility(
    { hidden: true, lastScrollTop: 400, accumulatedDelta: 50, direction: 1 },
    { ...viewport, scrollTop: 10 },
  );
  assert.equal(state.hidden, false);
});
