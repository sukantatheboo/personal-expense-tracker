import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  computeHeaderScrollRange,
  computeScrollProgress,
  createDockScrollState,
  stepDockScrollVisibility,
} from "./scrollMath.js";

/**
 * Attaches ONE passive, requestAnimationFrame-throttled scroll listener to the active
 * scroll container, writes `--p` (0..1) directly on the screen root element, and
 * optionally drives dock hide-on-scroll via DOM attributes (zero setState on scroll).
 */
export function useScrollProgress({
  activeTab,
  activePlan = null,
  hideDockOnScroll = false,
  dockRef = null,
  plansScrollStore = null,
}) {
  const screenRootRef = useRef(null);
  const scrollerMapRef = useRef(new Map());
  const tabScrollerRefs = useRef({});
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [scrollerRevision, setScrollerRevision] = useState(0);
  const tabScrollTopRef = useRef({
    home: 0,
    activity: 0,
    accounts: 0,
    plans: 0,
    "app-settings": 0,
    "profile-settings": 0,
  });
  const rafIdRef = useRef(0);
  const rangeRef = useRef({ start: 20, end: 64 });
  const dockScrollStateRef = useRef(createDockScrollState(0));

  const getActiveScroller = useCallback(() => {
    const panel = scrollerMapRef.current.get(activeTab) || null;
    if (!panel) return null;
    if (activeTab === "plans") {
      return panel.querySelector(".plans-tab-scroller.is-active") || panel;
    }
    if (activeTab === "activity") {
      return panel.querySelector(".activity-scroll-feed") || panel;
    }
    return panel;
  }, [activeTab]);

  const measureHeaderRange = useCallback(() => {
    const panel = scrollerMapRef.current.get(activeTab) || null;
    if (!panel) {
      rangeRef.current = computeHeaderScrollRange(64);
      return rangeRef.current;
    }
    const largeHeaderEl = panel.querySelector(".prototype-large-title-row");
    if (!largeHeaderEl) {
      rangeRef.current = computeHeaderScrollRange(64);
      return rangeRef.current;
    }
    const rect = largeHeaderEl.getBoundingClientRect();
    let measured = rect.height;
    if (measured > 0 && typeof window !== "undefined") {
      const style = window.getComputedStyle(largeHeaderEl);
      const padTop = parseFloat(style.paddingTop) || 0;
      // Exclude dynamic safe-area-inset-top so start/end match the scrollable header content height
      const extraSafeTop = Math.max(0, padTop - 12);
      measured = Math.max(44, measured - extraSafeTop);
    }
    rangeRef.current = computeHeaderScrollRange(measured);
    return rangeRef.current;
  }, [activeTab]);

  const applyDockScrollHidden = useCallback(
    (hidden) => {
      const dockEl = dockRef?.current;
      if (!dockEl) return;
      const shouldHide = Boolean(hideDockOnScroll && hidden);
      if (shouldHide) {
        if (dockEl.getAttribute("data-scroll-hidden") !== "true") {
          const activeEl =
            typeof document !== "undefined" ? document.activeElement : null;
          if (
            activeEl &&
            dockEl.contains(activeEl) &&
            typeof activeEl.blur === "function"
          ) {
            activeEl.blur();
          }
          dockEl.inert = true;
          dockEl.setAttribute("data-scroll-hidden", "true");
          dockEl.setAttribute("aria-hidden", "true");
        }
      } else {
        if (dockEl.hasAttribute("data-scroll-hidden")) {
          dockEl.removeAttribute("data-scroll-hidden");
        }
        // Only restore focusability & aria-hidden if not hidden by keyboard or settings
        if (
          dockEl.getAttribute("data-hidden") !== "true" &&
          dockEl.getAttribute("data-keyboard-open") !== "true"
        ) {
          dockEl.inert = false;
          if (dockEl.getAttribute("aria-hidden") === "true") {
            dockEl.removeAttribute("aria-hidden");
          }
        }
      }
    },
    [dockRef, hideDockOnScroll],
  );

  const applyProgressFromScrollTop = useCallback((scrollTop) => {
    const rootEl = screenRootRef.current;
    if (!rootEl) return;
    const { start, end } = rangeRef.current;
    const progress = computeScrollProgress(scrollTop, start, end);
    rootEl.style.setProperty("--p", progress.toFixed(4));
  }, []);

  const registerTabScroller = useCallback((tabKey) => {
    if (!tabScrollerRefs.current[tabKey]) {
      tabScrollerRefs.current[tabKey] = (node) => {
        const prev = scrollerMapRef.current.get(tabKey) || null;
        const next = node || null;
        if (next) {
          scrollerMapRef.current.set(tabKey, next);
        } else {
          scrollerMapRef.current.delete(tabKey);
        }
        if (prev !== next && activeTabRef.current === tabKey) {
          setScrollerRevision((v) => v + 1);
        }
      };
    }
    return tabScrollerRefs.current[tabKey];
  }, []);

  const scrollToTop = useCallback(() => {
    const panel = scrollerMapRef.current.get(activeTab) || null;
    if (!panel) return;
    const target =
      panel.querySelector(
        ".activity-scroll-feed, .plans-tab-scroller.is-active",
      ) || panel;
    tabScrollTopRef.current[activeTab] = 0;
    if (activeTab === "plans" && plansScrollStore) {
      const activePlanShell = panel.querySelector(".plans-screen-shell");
      const activePlanKey =
        activePlanShell?.getAttribute("data-active-plan") || "budget";
      plansScrollStore[activePlanKey] = 0;
    }
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    target.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeTab, plansScrollStore]);

  // Restore saved scrollTop, measure header height, sync --p, and reset dock visibility on route change
  useLayoutEffect(() => {
    const scroller = getActiveScroller();
    measureHeaderRange();
    const savedTop = tabScrollTopRef.current[activeTab] ?? 0;
    if (scroller) {
      // Plans manages per-subtab (budget/rec) scroll restoration via plansScrollStore
      const ownsOwnScrollStore =
        activeTab === "plans" && Boolean(plansScrollStore);
      if (!ownsOwnScrollStore && Math.abs(scroller.scrollTop - savedTop) > 1) {
        void scroller.offsetHeight;
        scroller.scrollTop = savedTop;
      }
      dockScrollStateRef.current = createDockScrollState(scroller.scrollTop);
      applyProgressFromScrollTop(scroller.scrollTop);
    } else {
      dockScrollStateRef.current = createDockScrollState(0);
      applyProgressFromScrollTop(0);
    }
    applyDockScrollHidden(false);
  }, [
    activeTab,
    activePlan,
    scrollerRevision,
    plansScrollStore,
    getActiveScroller,
    measureHeaderRange,
    applyProgressFromScrollTop,
    applyDockScrollHidden,
  ]);

  // Bind ONE passive rAF-throttled scroll listener to the active scroller
  useEffect(() => {
    const scroller = getActiveScroller();
    if (!scroller) return undefined;

    let ticking = false;

    const update = () => {
      ticking = false;
      // Guard against synthetic scroll-to-0 when a tab panel becomes hidden
      if (!scroller.offsetParent && scroller.scrollTop === 0) return;
      const top = scroller.scrollTop;
      tabScrollTopRef.current[activeTab] = top;
      applyProgressFromScrollTop(top);

      if (hideDockOnScroll) {
        const nextDockState = stepDockScrollVisibility(
          dockScrollStateRef.current,
          {
            scrollTop: top,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          },
        );
        dockScrollStateRef.current = nextDockState;
        applyDockScrollHidden(nextDockState.hidden);
      }
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        rafIdRef.current = window.requestAnimationFrame(update);
      }
    };

    const onResize = () => {
      measureHeaderRange();
      applyProgressFromScrollTop(scroller.scrollTop);
    };

    measureHeaderRange();
    applyProgressFromScrollTop(scroller.scrollTop);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      if (rafIdRef.current) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [
    activeTab,
    activePlan,
    scrollerRevision,
    hideDockOnScroll,
    getActiveScroller,
    measureHeaderRange,
    applyProgressFromScrollTop,
    applyDockScrollHidden,
  ]);

  return {
    screenRootRef,
    registerTabScroller,
    scrollToTop,
    tabScrollTopRef,
    getActiveScroller,
  };
}
