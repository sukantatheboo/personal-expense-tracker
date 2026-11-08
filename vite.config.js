import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/personal-expense-tracker/" : "/",
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  build: {
    target: "es2022",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@supabase/")) {
            return "supabase";
          }
          if (id.includes("@capacitor/")) {
            return "capacitor";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
}));
