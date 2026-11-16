// Early theme boot to synchronize background and status bar chrome before render
try {
  const savedTheme = localStorage.getItem("spend-theme-v1");
  const isDark =
    savedTheme === "dark" ||
    (savedTheme !== "light" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const themeColor = isDark ? "#08080c" : "#f4f3ee";
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", themeColor));
} catch {
  // ignore
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

const CURRENT_BUILD_ID =
  typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";
const CURRENT_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2.0.0";
const CURRENT_COMMIT =
  typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "";
const CURRENT_BUILT_AT =
  typeof __APP_BUILT_AT__ !== "undefined" ? __APP_BUILT_AT__ : "";

const INSTALLED_BUILD_KEY = "spend-installed-build-id-v1";
const ACCEPTED_BUILD_KEY = "spend-update-accepted-v1";

function isAndroidRuntime() {
  if (typeof window === "undefined") return false;
  try {
    if (document.documentElement?.dataset?.platform === "android") return true;
    if (window.Capacitor?.getPlatform?.() === "android") return true;
  } catch {
    // ignore
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const plat =
    (typeof navigator !== "undefined" &&
      (navigator.userAgentData?.platform || navigator.platform)) ||
    "";
  return /android/i.test(ua) || /android/i.test(plat);
}

if (typeof window !== "undefined") {
  // Capture beforeinstallprompt on Android Chrome for WebAPK installation
  if (isAndroidRuntime()) {
    window.__spendDeferredInstallPrompt =
      window.__spendDeferredInstallPrompt || null;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      window.__spendDeferredInstallPrompt = event;
      window.dispatchEvent(
        new CustomEvent("spend:install-available", {
          detail: { available: true },
        }),
      );
    });

    window.addEventListener("appinstalled", () => {
      window.__spendDeferredInstallPrompt = null;
      window.dispatchEvent(
        new CustomEvent("spend:install-available", {
          detail: { available: false },
        }),
      );
      window.dispatchEvent(new CustomEvent("spend:app-installed"));
    });

    window.__spendCanInstallWebApk = () =>
      Boolean(window.__spendDeferredInstallPrompt);

    window.__spendPromptInstall = async () => {
      const promptEvent = window.__spendDeferredInstallPrompt;
      if (!promptEvent || typeof promptEvent.prompt !== "function") {
        return { outcome: "unavailable" };
      }
      try {
        await promptEvent.prompt();
        const choiceResult = await promptEvent.userChoice;
        if (choiceResult?.outcome === "accepted") {
          window.__spendDeferredInstallPrompt = null;
          window.dispatchEvent(
            new CustomEvent("spend:install-available", {
              detail: { available: false },
            }),
          );
        }
        return choiceResult || { outcome: "dismissed" };
      } catch {
        return { outcome: "error" };
      }
    };
  }

  let swRegistration = null;
  let refreshing = false;
  let updateAccepted = false;
  let latestDetectedManifest = null;
  let versionCheckInFlight = null;

  const readInstalledBuildId = () => {
    try {
      return localStorage.getItem(INSTALLED_BUILD_KEY) || "";
    } catch {
      return "";
    }
  };

  const writeInstalledBuildId = (id) => {
    if (!id || id === "sw-pending-update") return;
    try {
      localStorage.setItem(INSTALLED_BUILD_KEY, id);
    } catch {
      // ignore storage errors
    }
  };

  const readAcceptedBuildId = () => {
    try {
      return sessionStorage.getItem(ACCEPTED_BUILD_KEY) || "";
    } catch {
      return "";
    }
  };

  const writeAcceptedBuildId = (id) => {
    try {
      if (id) {
        sessionStorage.setItem(ACCEPTED_BUILD_KEY, id);
      } else {
        sessionStorage.removeItem(ACCEPTED_BUILD_KEY);
      }
    } catch {
      // ignore storage errors
    }
  };

  const hasExistingUserInstall = () => {
    try {
      return (
        Boolean(localStorage.getItem(INSTALLED_BUILD_KEY)) ||
        localStorage.getItem("spend:welcome-seen") === "1" ||
        Boolean(localStorage.getItem("spend-local-data-owner-v1")) ||
        Boolean(localStorage.getItem("spend-expenses-v1")) ||
        Boolean(localStorage.getItem("spend-accounts-v1"))
      );
    } catch {
      return false;
    }
  };

  const hasLegacyShellCache = async () => {
    if (!("caches" in window)) return false;
    try {
      const keys = await window.caches.keys();
      const currentCacheName = `spend-shell-${CURRENT_BUILD_ID}`;
      return keys.some(
        (key) => key.startsWith("spend-shell-") && key !== currentCacheName,
      );
    } catch {
      return false;
    }
  };

  const cleanupLegacyShellCaches = async (keepBuildId = CURRENT_BUILD_ID) => {
    if (!("caches" in window)) return;
    try {
      const keepCacheName =
        keepBuildId && keepBuildId !== "sw-pending-update"
          ? `spend-shell-${keepBuildId}`
          : "";
      const keys = await window.caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith("spend-shell-") && key !== keepCacheName,
          )
          .map((key) => window.caches.delete(key)),
      );
    } catch {
      // ignore cache cleanup errors
    }
  };

  // If we just reloaded after the user clicked "Update now", mark the current build as installed.
  if (import.meta.env.PROD) {
    const accepted = readAcceptedBuildId();
    if (accepted === CURRENT_BUILD_ID || accepted === "1") {
      writeAcceptedBuildId("");
      writeInstalledBuildId(CURRENT_BUILD_ID);
    } else if (!hasExistingUserInstall()) {
      // First-ever visit on a clean device: record current build without prompting.
      writeInstalledBuildId(CURRENT_BUILD_ID);
    }
  }

  const resolveIndexUrl = () => {
    try {
      const base =
        swRegistration?.scope ||
        new URL(
          import.meta.env.BASE_URL || "./",
          window.location.href,
        ).toString();
      return new URL("index.html", base).toString();
    } catch {
      return `${import.meta.env.BASE_URL || "/"}index.html`;
    }
  };

  const getWorkerVersionInfo = (worker, timeoutMs = 1200) =>
    new Promise((resolve) => {
      if (!worker || typeof MessageChannel === "undefined") {
        resolve(null);
        return;
      }
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val || null);
      };
      const timer = window.setTimeout(() => done(null), timeoutMs);
      try {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          window.clearTimeout(timer);
          if (event.data?.type === "VERSION_INFO") {
            done(event.data);
          } else {
            done(null);
          }
        };
        worker.postMessage({ type: "GET_VERSION_INFO" }, [channel.port2]);
      } catch {
        window.clearTimeout(timer);
        done(null);
      }
    });

  const dispatchUpdateAvailable = (info = {}) => {
    const candidateBuildId =
      info.buildId ||
      latestDetectedManifest?.buildId ||
      "sw-pending-update";
    const candidateVersion =
      info.version ||
      latestDetectedManifest?.version ||
      CURRENT_VERSION ||
      "";
    const detail = {
      buildId: candidateBuildId,
      version: candidateVersion,
      commit: info.commit || latestDetectedManifest?.commit || CURRENT_COMMIT || "",
      builtAt:
        info.builtAt || latestDetectedManifest?.builtAt || CURRENT_BUILT_AT || "",
      source: info.source || "sw",
      manual: Boolean(info.manual),
    };
    window.__spendPendingUpdate = detail;
    window.dispatchEvent(
      new CustomEvent("spend:update-available", { detail }),
    );
  };

  const checkUnacknowledgedCurrentBuild = async ({ manual = false } = {}) => {
    if (!import.meta.env.PROD) return false;
    const accepted = readAcceptedBuildId();
    if (accepted === CURRENT_BUILD_ID || accepted === "1") {
      writeAcceptedBuildId("");
      writeInstalledBuildId(CURRENT_BUILD_ID);
      return false;
    }
    const installed = readInstalledBuildId();
    const legacyCacheFound = await hasLegacyShellCache();
    const isUnacknowledgedNewBuild =
      (installed && installed !== CURRENT_BUILD_ID) ||
      (!installed && (legacyCacheFound || hasExistingUserInstall()));

    if (isUnacknowledgedNewBuild) {
      const currentManifest = {
        buildId: CURRENT_BUILD_ID,
        version: CURRENT_VERSION,
        commit: CURRENT_COMMIT,
        builtAt: CURRENT_BUILT_AT,
      };
      latestDetectedManifest = currentManifest;
      dispatchUpdateAvailable({
        ...currentManifest,
        source: "unacknowledged-build",
        manual,
      });
      return true;
    }
    return false;
  };

  window.__spendAcknowledgeUpdate = (buildId) => {
    const targetId = buildId || window.__spendPendingUpdate?.buildId || "";
    if (!targetId || targetId === CURRENT_BUILD_ID) {
      writeInstalledBuildId(CURRENT_BUILD_ID);
      delete window.__spendPendingUpdate;
      if (swRegistration?.waiting) {
        swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      void cleanupLegacyShellCaches(CURRENT_BUILD_ID);
    }
  };

  const checkRemoteVersion = async ({ force = false, manual = false } = {}) => {
    if (!import.meta.env.PROD && !force) return false;
    if (versionCheckInFlight) {
      const result = await versionCheckInFlight;
      if (manual && (result || window.__spendPendingUpdate)) {
        dispatchUpdateAvailable({
          ...(window.__spendPendingUpdate || latestDetectedManifest || {}),
          manual: true,
        });
        return true;
      }
      if (!manual) return result;
    }

    versionCheckInFlight = (async () => {
      try {
        if (swRegistration) {
          void Promise.race([
            swRegistration.update().catch(() => {}),
            new Promise((resolve) => window.setTimeout(resolve, 1500)),
          ]);
        }

        const versionUrl = new URL(
          `version.json?t=${Date.now()}`,
          swRegistration?.scope ||
            new URL(
              import.meta.env.BASE_URL || "./",
              window.location.href,
            ).toString(),
        ).toString();

        const response = await fetch(versionUrl, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });

        if (response.ok) {
          const manifest = await response.json();
          if (
            manifest &&
            typeof manifest.buildId === "string" &&
            manifest.buildId
          ) {
            if (manifest.buildId !== CURRENT_BUILD_ID) {
              latestDetectedManifest = manifest;
              swRegistration?.update().catch(() => {});
              dispatchUpdateAvailable({
                ...manifest,
                source: "version-json",
                manual,
              });
              return true;
            }

            // Remote manifest matches CURRENT_BUILD_ID.
            // Check if the browser loaded this new build over an older install without showing the modal yet.
            if (await checkUnacknowledgedCurrentBuild({ manual })) {
              return true;
            }

            writeInstalledBuildId(CURRENT_BUILD_ID);

            if (swRegistration?.waiting && navigator.serviceWorker?.controller) {
              const workerInfo = await getWorkerVersionInfo(
                swRegistration.waiting,
              );
              if (
                workerInfo?.buildId &&
                workerInfo.buildId !== "dev" &&
                workerInfo.buildId !== CURRENT_BUILD_ID
              ) {
                latestDetectedManifest = workerInfo;
                dispatchUpdateAvailable({
                  ...workerInfo,
                  source: "sw-waiting",
                  manual,
                });
                return true;
              }
              // Waiting worker matches CURRENT_BUILD_ID; activate it silently so controller is up to date.
              swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
            }

            latestDetectedManifest = null;
            delete window.__spendPendingUpdate;
            return false;
          }
        }

        if (swRegistration?.waiting && navigator.serviceWorker?.controller) {
          const workerInfo = await getWorkerVersionInfo(swRegistration.waiting);
          if (
            workerInfo?.buildId
              ? workerInfo.buildId !== CURRENT_BUILD_ID
              : import.meta.env.PROD
          ) {
            dispatchUpdateAvailable({
              ...(workerInfo ||
                latestDetectedManifest ||
                window.__spendPendingUpdate ||
                {}),
              source: "sw-waiting",
              manual,
            });
            return true;
          }
        }

        if (await checkUnacknowledgedCurrentBuild({ manual })) {
          return true;
        }

        if (window.__spendPendingUpdate) {
          dispatchUpdateAvailable({
            ...window.__spendPendingUpdate,
            manual,
          });
          return true;
        }
        return false;
      } catch {
        if (swRegistration?.waiting && navigator.serviceWorker?.controller) {
          const workerInfo = await getWorkerVersionInfo(swRegistration.waiting);
          if (
            workerInfo?.buildId
              ? workerInfo.buildId !== CURRENT_BUILD_ID
              : import.meta.env.PROD
          ) {
            dispatchUpdateAvailable({
              ...(workerInfo ||
                latestDetectedManifest ||
                window.__spendPendingUpdate ||
                {}),
              source: "sw-waiting",
              manual,
            });
            return true;
          }
        }
        if (await checkUnacknowledgedCurrentBuild({ manual })) {
          return true;
        }
        if (window.__spendPendingUpdate) {
          dispatchUpdateAvailable({
            ...window.__spendPendingUpdate,
            manual,
          });
          return true;
        }
        return false;
      } finally {
        versionCheckInFlight = null;
      }
    })();

    return versionCheckInFlight;
  };

  window.__spendCheckForUpdates = checkRemoteVersion;

  const waitForWaitingWorker = (reg, timeoutMs = 3500) =>
    new Promise((resolve) => {
      if (!reg) {
        resolve(null);
        return;
      }
      if (reg.waiting) {
        resolve(reg.waiting);
        return;
      }
      const installing = reg.installing;
      if (!installing) {
        resolve(null);
        return;
      }
      let settled = false;
      const done = (worker) => {
        if (settled) return;
        settled = true;
        resolve(worker || null);
      };
      const timer = window.setTimeout(() => done(reg.waiting), timeoutMs);
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") {
          window.clearTimeout(timer);
          done(reg.waiting || installing);
        } else if (installing.state === "redundant") {
          window.clearTimeout(timer);
          done(null);
        }
      });
    });

  const refreshCachedIndex = async (targetBuildId = "") => {
    try {
      const fullIndexUrl = resolveIndexUrl();
      const scopeRootUrl = new URL("./", fullIndexUrl).toString();
      const freshRes = await fetch(fullIndexUrl, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
      if (freshRes.ok && "caches" in window) {
        const keys = await window.caches.keys();
        const shellKeys = keys.filter((k) => k.startsWith("spend-shell-"));
        const targetCacheName =
          targetBuildId && targetBuildId !== "sw-pending-update"
            ? `spend-shell-${targetBuildId}`
            : `spend-shell-${CURRENT_BUILD_ID}`;
        const cachesToUpdate = new Set([...shellKeys, targetCacheName]);
        await Promise.all(
          [...cachesToUpdate].map(async (k) => {
            const cache = await window.caches.open(k);
            await cache.put(fullIndexUrl, freshRes.clone());
            await cache.put(scopeRootUrl, freshRes.clone());
          }),
        );
      }
    } catch {
      // ignore
    }
  };

  window.__spendApplyUpdate = async () => {
    if (refreshing) return;
    updateAccepted = true;

    const targetBuildId =
      latestDetectedManifest?.buildId ||
      window.__spendPendingUpdate?.buildId ||
      CURRENT_BUILD_ID;

    writeAcceptedBuildId(
      targetBuildId && targetBuildId !== "sw-pending-update"
        ? targetBuildId
        : "1",
    );
    if (targetBuildId && targetBuildId !== "sw-pending-update") {
      writeInstalledBuildId(targetBuildId);
    } else {
      writeInstalledBuildId(CURRENT_BUILD_ID);
    }

    const reloadCleanly = async () => {
      if (refreshing) return;
      refreshing = true;
      await cleanupLegacyShellCaches(targetBuildId);
      await refreshCachedIndex(targetBuildId);
      window.location.reload();
    };

    try {
      let waitingWorker = swRegistration?.waiting || null;
      if (!waitingWorker && swRegistration) {
        if (!swRegistration.installing) {
          await Promise.race([
            swRegistration.update().catch(() => {}),
            new Promise((resolve) => window.setTimeout(resolve, 1500)),
          ]);
        }
        waitingWorker = await waitForWaitingWorker(swRegistration, 3000);
      }

      if (waitingWorker) {
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
        window.setTimeout(reloadCleanly, 2200);
        return;
      }
    } catch {
      // Fall through to reload if cache cleanup or SW messaging fails.
    }

    await reloadCleanly();
  };

  const triggerUpdateCheck = () => {
    if (document.visibilityState === "visible") {
      void checkRemoteVersion();
    }
  };

  document.addEventListener("visibilitychange", triggerUpdateCheck);
  window.addEventListener("focus", triggerUpdateCheck);
  window.addEventListener("pageshow", triggerUpdateCheck);
  window.addEventListener("online", triggerUpdateCheck);
  window.setTimeout(triggerUpdateCheck, 800);
  window.setInterval(triggerUpdateCheck, 45 * 1000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateAccepted && !refreshing) {
        refreshing = true;
        const targetBuildId =
          latestDetectedManifest?.buildId ||
          window.__spendPendingUpdate?.buildId ||
          CURRENT_BUILD_ID;
        cleanupLegacyShellCaches(targetBuildId)
          .then(() => refreshCachedIndex(targetBuildId))
          .finally(() => {
            window.location.reload();
          });
      }
    });

    const handleReadyWaitingWorker = async (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      const found = await checkRemoteVersion({ force: true });
      if (found) return;
      const workerInfo = await getWorkerVersionInfo(worker);
      if (workerInfo?.buildId && workerInfo.buildId === CURRENT_BUILD_ID) {
        if (!(await checkUnacknowledgedCurrentBuild())) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
        return;
      }
      if (!import.meta.env.PROD && !workerInfo?.buildId) {
        return;
      }
      dispatchUpdateAvailable({
        ...(workerInfo || {}),
        source: "sw-installed",
      });
    };

    const watchInstallingWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          void handleReadyWaitingWorker(worker);
        }
      });
    };

    const registerSw = () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          updateViaCache: "none",
        })
        .then((registration) => {
          swRegistration = registration;

          if (registration.waiting && navigator.serviceWorker.controller) {
            void handleReadyWaitingWorker(registration.waiting);
          }

          if (registration.installing) {
            watchInstallingWorker(registration.installing);
          }

          registration.addEventListener("updatefound", () => {
            watchInstallingWorker(registration.installing);
          });

          triggerUpdateCheck();
        })
        .catch((error) => {
          console.error("Service worker registration failed:", error);
        });
    };

    if (document.readyState === "complete") {
      registerSw();
    } else {
      window.addEventListener("load", registerSw, { once: true });
    }
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
