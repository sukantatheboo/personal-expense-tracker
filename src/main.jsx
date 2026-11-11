import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

if ("serviceWorker" in navigator) {
  let refreshing = false;
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (import.meta.env.PROD && hadController && !refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

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

  if (document.readyState === "complete") {
    registerSw();
  } else {
    window.addEventListener("load", registerSw, { once: true });
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
