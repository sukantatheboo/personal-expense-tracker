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
    .catch((error) => {
      console.error("Service worker registration failed:", error);
    });
}
