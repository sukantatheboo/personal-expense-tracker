import { defineConfig } from "vite";

export default defineConfig({
  base: "/personal-expense-tracker/",
  plugins: [
    {
      name: "serve-root-manifest",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (
            req.url === "/manifest.webmanifest" ||
            req.url === "/manifest.json"
          ) {
            req.url = "/personal-expense-tracker/manifest.webmanifest";
          }
          next();
        });
      },
    },
  ],
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        // Only preload the React runtime for the initial shell; let lazy-loaded
        // route/feature chunks load asynchronously after First Contentful Paint.
        return deps.filter(
          (dep) =>
            !dep.includes("supabase") &&
            !dep.includes("capacitor") &&
            !dep.includes("MobilePrototype") &&
            !dep.includes("icons") &&
            !dep.includes("cardAssets") &&
            !dep.includes("MonthEndBanner") &&
            !dep.includes("SpendLogin"),
        );
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@supabase")) {
            return "supabase";
          }
          if (id.includes("@capacitor")) {
            return "capacitor";
          }
          if (id.includes("react-icons")) {
            return "icons";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
        },
      },
    },
  },
});
