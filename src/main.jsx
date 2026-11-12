import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

const CURRENT_BUILD_ID =
  typeof __APP_BUILD_ID__ !== "undefined" ? __APP_BUILD_ID__ : "dev";
const CURRENT_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "2.0.0";

if (typeof window !== "undefined") {
  let swRegistration = null;
  let refreshing = false;
  let updateAccepted = false;
  let latestDetectedManifest = null;
  let versionCheckInFlight = null;

  const resolveIndexUrl = () => {
    try {
      const base =
        swRegistration?.scope ||
        new URL(import.meta.env.BASE_URL || "./", window.location.href).toString();
      return new URL("index.html", base).toString();
    } catch {
      return `${import.meta.env.BASE_URL || "/"}index.html`;
    }
  };

  const dispatchUpdateAvailable = (info = {}) => {
    const candidateVersion =
      info.version || latestDetectedManifest?.version || "";
    const detail = {
      buildId:
        info.buildId ||
        latestDetectedManifest?.buildId ||
        "sw-pending-update",
      version:
        candidateVersion &&
        (info.buildId || latestDetectedManifest?.buildId) !== CURRENT_BUILD_ID
          ? candidateVersion
          : candidateVersion !== CURRENT_VERSION
            ? candidateVersion
            : "",
      commit: info.commit || latestDetectedManifest?.commit || "",
      builtAt: info.builtAt || latestDetectedManifest?.builtAt || "",
      source: info.source || "sw",
      manual: Boolean(info.manual),
    };
    window.__spendPendingUpdate = detail;
    window.dispatchEvent(
      new CustomEvent("spend:update-available", { detail }),
    );
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
      return result;
    }

    versionCheckInFlight = (async () => {
      try {
        if (swRegistration) {
          await swRegistration.update().catch(() => {});
        }
        const versionUrl = new URL(
          `version.json?t=${Date.now()}`,
          swRegistration?.scope ||
            new URL(import.meta.env.BASE_URL || "./", window.location.href).toString(),
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
            if (!swRegistration?.waiting) {
              latestDetectedManifest = null;
              delete window.__spendPendingUpdate;
              return false;
            }
          }
        }
        if (swRegistration?.waiting && navigator.serviceWorker?.controller) {
          dispatchUpdateAvailable({
            ...(latestDetectedManifest || window.__spendPendingUpdate || {}),
            source: "sw-waiting",
            manual,
          });
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
          dispatchUpdateAvailable({
            ...(latestDetectedManifest || window.__spendPendingUpdate || {}),
            source: "sw-waiting",
            manual,
          });
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

  const waitForWaitingWorker = (reg, timeoutMs = 4000) =>
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

  const refreshCachedIndex = async () => {
    try {
      const fullIndexUrl = resolveIndexUrl();
      const freshRes = await fetch(fullIndexUrl, { cache: "reload" });
      if (freshRes.ok && "caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("spend-shell-"))
            .map(async (k) => {
              const cache = await window.caches.open(k);
              await cache.put(fullIndexUrl, freshRes.clone());
            }),
        );
      }
    } catch {}
  };

  window.__spendApplyUpdate = async () => {
    if (refreshing) return;
    updateAccepted = true;

    const reloadCleanly = async () => {
      if (refreshing) return;
      refreshing = true;
      await refreshCachedIndex();
      window.location.reload();
    };

    try {
      let waitingWorker = swRegistration?.waiting || null;
      if (!waitingWorker && swRegistration) {
        if (!swRegistration.installing) {
          await swRegistration.update().catch(() => {});
        }
        waitingWorker = await waitForWaitingWorker(swRegistration, 4000);
      }

      if (waitingWorker) {
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
        window.setTimeout(reloadCleanly, 2500);
        return;
      }

      if ("caches" in window) {
        const targetBuildId =
          latestDetectedManifest?.buildId ||
          window.__spendPendingUpdate?.buildId ||
          "";
        const keepCacheName =
          targetBuildId && targetBuildId !== "sw-pending-update"
            ? `spend-shell-${targetBuildId}`
            : "";
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter(
              (key) => key.startsWith("spend-shell-") && key !== keepCacheName,
            )
            .map((key) => window.caches.delete(key)),
        );
      }
    } catch {
      // Fall through to reload if cache cleanup or SW messaging fails.
    }

    await reloadCleanly();
  };

  const triggerUpdateCheck = () => {
    if (document.visibilityState === "visible") {
      swRegistration?.update().catch(() => {});
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
        refreshCachedIndex().finally(() => {
          window.location.reload();
        });
      }
    });

    const watchInstallingWorker = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          void checkRemoteVersion({ force: true }).then((found) => {
            if (!found) {
              dispatchUpdateAvailable({ source: "sw-installed" });
            }
          });
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
            void checkRemoteVersion({ force: true }).then((found) => {
              if (!found) {
                dispatchUpdateAvailable({ source: "sw-waiting" });
              }
            });
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
