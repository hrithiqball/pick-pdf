import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

// One config for the whole toolchain: build/dev (Vite + Cloudflare), format (Oxfmt),
// lint (Oxlint), tests (Vitest + Playwright) and project tasks (Vite Task).
export default defineConfig({
  // The Cloudflare plugin boots workerd; Vitest doesn't need it (e2e tests hit `vp preview`).
  // E2E_PERSIST_DIR gives the e2e suite an isolated, throwaway copy of local R2/DO state.
  plugins: process.env.VITEST
    ? []
    : [
        cloudflare({
          persistState: process.env.E2E_PERSIST_DIR ? { path: process.env.E2E_PERSIST_DIR } : true,
          inspectorPort: false,
        }),
      ],

  fmt: {
    printWidth: 100,
    ignorePatterns: ["dist/**", "worker-configuration.d.ts", "pnpm-lock.yaml"],
  },

  lint: {
    ignorePatterns: ["dist/**", "worker-configuration.d.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    categories: { correctness: "error", suspicious: "warn" },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-explicit-any": "error",
      eqeqeq: "error",
      "no-console": ["warn", { allow: ["log", "warn", "error"] }],
    },
    overrides: [
      {
        // Tests parse known API responses; type guards there would only add noise.
        files: ["tests/**"],
        rules: { "typescript/no-unsafe-type-assertion": "off" },
      },
    ],
    options: { typeAware: true, typeCheck: true },
  },

  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/e2e/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },

  run: {
    tasks: {
      ci: { command: ["vp check", "vp test"], cache: false },
      "test:unit": { command: "vp test --project unit", cache: false },
      "test:e2e": { command: "vp test --project e2e", cache: false },
      typegen: { command: "wrangler types", cache: false },
      deploy: { command: ["vp build", "wrangler deploy"], cache: false },
    },
  },
});
