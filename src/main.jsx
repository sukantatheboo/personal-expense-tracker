import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let refreshing = false;
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener("load", () => {
    const registerSw = () => {
      navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((registration) => {
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              registration.update().catch(() => {});
            }
          });
        })
        .catch((error) => {
          console.error("Service worker registration failed:", error);
        });
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(registerSw, { timeout: 2000 });
    } else {
      window.setTimeout(registerSw, 1200);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
