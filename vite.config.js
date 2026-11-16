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

function resolveGitCommitCount() {
  try {
    const count = Number(
      execSync("git rev-list --count HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim(),
    );
    if (Number.isFinite(count) && count > 1) return count;
    const runNumber = Number(process.env.GITHUB_RUN_NUMBER);
    if (Number.isFinite(runNumber) && runNumber > 0) return runNumber;
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    const runNumber = Number(process.env.GITHUB_RUN_NUMBER);
    return Number.isFinite(runNumber) && runNumber > 0 ? runNumber : 0;
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    );
    const rawVersion = String(pkg.version || "2.0.0").trim();
    const parts = rawVersion.split(".");
    const commitCount = resolveGitCommitCount();
    if (parts.length >= 2 && commitCount > 0) {
      const major = parts[0] || "2";
      const minor = parts[1] || "0";
      const explicitPatch = Number(parts[2]) || 0;
      const patch = explicitPatch > commitCount ? explicitPatch : commitCount;
      return `${major}.${minor}.${patch}`;
    }
    return rawVersion || "2.0.0";
  } catch {
    return "2.0.0";
  }
}

function createVersionManifest() {
  const pkgVer = readPackageVersion();
  const commit = resolveGitCommit();
  const timestamp = Date.now();
  const iso = new Date(timestamp).toISOString();
  const id = `${pkgVer}${commit ? `-${commit}` : ""}-${timestamp}`;
  return {
    buildId: id,
    version: pkgVer,
    commit: commit || null,
    builtAt: iso,
  };
}

const versionManifest = createVersionManifest();
const { buildId, version: pkgVersion, commit: gitCommit, builtAt } =
  versionManifest;

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
          let precacheAssets = [];
          try {
            const indexHtmlPath = resolve(resolvedOutDir, "index.html");
            if (existsSync(indexHtmlPath)) {
              const html = readFileSync(indexHtmlPath, "utf8");
              const matches = html.matchAll(
                /(?:src|href)=["'](?:\.\/|\/personal-expense-tracker\/|\/)?(assets\/[^"'?#]+)["']/g,
              );
              precacheAssets = [
                ...new Set(Array.from(matches, (m) => m[1]).filter(Boolean)),
              ];
            }
          } catch {
            precacheAssets = [];
          }

          const swSource = readFileSync(swPath, "utf8");
          const stampedSw = swSource
            .replace(
              /const CACHE_NAME = ["'][^"']*["'];/,
              `const CACHE_NAME = ${JSON.stringify(`spend-shell-${buildId}`)};`,
            )
            .replace(
              /const SW_BUILD_ID = ["'][^"']*["'];/,
              `const SW_BUILD_ID = ${JSON.stringify(buildId)};`,
            )
            .replace(
              /const SW_VERSION = ["'][^"']*["'];/,
              `const SW_VERSION = ${JSON.stringify(pkgVersion)};`,
            )
            .replace(
              /const SW_COMMIT = ["'][^"']*["'];/,
              `const SW_COMMIT = ${JSON.stringify(gitCommit || "")};`,
            )
            .replace(
              /const SW_BUILT_AT = ["'][^"']*["'];/,
              `const SW_BUILT_AT = ${JSON.stringify(builtAt)};`,
            )
            .replace(
              /const PRECACHE_ASSETS = \[[^\]]*\];/,
              `const PRECACHE_ASSETS = ${JSON.stringify(precacheAssets)};`,
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
  optimizeDeps: {
    include: ["lucide-react", "@capacitor/app"],
  },
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
