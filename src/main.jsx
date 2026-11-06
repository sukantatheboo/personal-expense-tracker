// Frame busting / Clickjacking protection
try {
  if (window.top !== window.self) {
    window.top.location = window.self.location;
  }
} catch {
  // ignore
}

// Early theme boot to prevent flash of unstyled theme
try {
  const savedTheme = localStorage.getItem("spend-theme-v1");
  const isDark =
    savedTheme === "dark" ||
    (!savedTheme &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const color = isDark ? "#0e1411" : "#f4f3ee";
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", color);
  });
} catch {
  // ignore
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
    .then((registration) => {
      registration.update();
    })
    .catch((error) => {
      console.error("Service worker registration failed:", error);
    });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}
