import { isHapticsEnabled } from "./data.js";

function isNativePlatform() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.Capacitor?.isNativePlatform?.())
  );
}

function hasWebUserActivation() {
  if (typeof navigator === "undefined") return false;
  // Vibration is gated by sticky user activation, especially inside iframes.
  // Skip it before the user has interacted with this frame to avoid a browser
  // intervention warning during startup or programmatic state changes.
  return navigator.userActivation?.hasBeenActive === true;
}

function triggerSafariWebHaptic() {
  if (!isHapticsEnabled()) return;
  if (typeof document === "undefined") return;
  try {
    let trigger = document.getElementById("safari-haptic-trigger");
    if (!trigger) {
      trigger = document.createElement("input");
      trigger.id = "safari-haptic-trigger";
      trigger.type = "checkbox";
      trigger.setAttribute("switch", "");
      trigger.setAttribute("aria-hidden", "true");
      trigger.tabIndex = -1;
      trigger.style.cssText =
        "position:fixed;opacity:0;pointer-events:none;left:-9999px;width:0;height:0;";
      document.body.appendChild(trigger);
    }
    trigger.click();
  } catch {
    // ignore
  }
}

export function triggerHaptic(type = "light") {
  if (!isHapticsEnabled()) return false;
  if (isNativePlatform()) {
    void import("@capacitor/haptics")
      .then(({ Haptics, ImpactStyle, NotificationType }) => {
        if (type === "medium" || (typeof type === "number" && type > 10)) {
          return Haptics.impact({ style: ImpactStyle.Medium });
        }
        if (type === "heavy") {
          return Haptics.impact({ style: ImpactStyle.Heavy });
        }
        if (type === "success") {
          return Haptics.notification({ type: NotificationType.Success });
        }
        if (type === "warning" || type === "delete") {
          return Haptics.notification({ type: NotificationType.Warning });
        }
        if (type === "selection") {
          return Haptics.selectionChanged();
        }
        return Haptics.impact({ style: ImpactStyle.Light });
      })
      .catch(() => {});
    return true;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    hasWebUserActivation()
  ) {
    try {
      const patterns = {
        selection: 12,
        light: 18,
        medium: 35,
        heavy: 55,
        success: [20, 40, 28],
        warning: [30, 35, 20],
        delete: [32, 38, 18],
      };
      const pattern =
        typeof type === "number" ? Math.max(12, type) : patterns[type] || 18;
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
    return false;
  }

  triggerSafariWebHaptic();
  return true;
}
