import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function resolveGitCommit() {
  if (process.env.GITHUB_SHA) {
    return String(process.env.GITHUB_SHA).slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );
    return pkg.version || "2.0.0";
  } catch {
    return "2.0.0";
  }
}

const pkgVersion = readPackageVersion();
const gitCommit = resolveGitCommit();
const builtAt = new Date().toISOString();
const buildTimestamp = Date.now();
const buildId = `${pkgVersion}${gitCommit ? `-${gitCommit}` : ""}-${buildTimestamp}`;

const versionManifest = {
  buildId,
  version: pkgVersion,
  commit: gitCommit || null,
  builtAt,
};

function spendBuildVersionPlugin() {
  let outDir = "dist";
  return {
    name: "spend-build-version",
    configResolved(config) {
      outDir = config.build.outDir || "dist";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = (req.url || "").split("?")[0];
        if (cleanUrl.endsWith("/version.json") || cleanUrl === "/version.json") {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(JSON.stringify(versionManifest, null, 2));
          return;
        }
        next();
      });
    },
    closeBundle() {
      try {
        const resolvedOutDir = resolve(process.cwd(), outDir);
        if (!existsSync(resolvedOutDir)) return;

        writeFileSync(
          resolve(resolvedOutDir, "version.json"),
          `${JSON.stringify(versionManifest, null, 2)}\n`,
          "utf8",
        );

        const swPath = resolve(resolvedOutDir, "sw.js");
        if (existsSync(swPath)) {
          const swSource = readFileSync(swPath, "utf8");
          const stampedSw = swSource.replace(
            /const CACHE_NAME = ["'][^"']+["'];/,
            `const CACHE_NAME = "spend-shell-${buildId}";`,
          );
          writeFileSync(swPath, stampedSw, "utf8");
        }
      } catch (error) {
        console.warn("Could not write build version artifacts:", error);
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/personal-expense-tracker/" : "/",
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __APP_COMMIT__: JSON.stringify(gitCommit || ""),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  plugins: [spendBuildVersionPlugin()],
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
