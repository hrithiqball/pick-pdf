// Builds the app and serves the production bundle (Worker + assets in workerd) via
// `vp preview`, so the e2e suite exercises exactly what gets deployed.
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vite-plus/test/node";

declare module "vite-plus/test" {
  interface ProvidedContext {
    baseURL: string;
  }
}

const root = new URL("../..", import.meta.url).pathname;
const vp = join(root, "node_modules/.bin/vp");

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // VITEST makes vite.config.ts drop the Cloudflare plugin, which build/preview need.
  const { VITEST: _vitest, VITEST_MODE: _mode, NODE_ENV: _nodeEnv, ...env } = process.env;
  return { ...env, ...extra };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vp preview exited early:\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}:\n${output()}`);
}

export default async function setup(project: TestProject): Promise<() => void> {
  if (!process.env.E2E_SKIP_BUILD) {
    const build = spawnSync(vp, ["build"], { cwd: root, env: childEnv(), encoding: "utf8" });
    if (build.status !== 0) throw new Error(`vp build failed:\n${build.stdout}\n${build.stderr}`);
  }

  // Fresh local R2/Durable Object state per run so tests never see stale files.
  const persistDir = mkdtempSync(join(tmpdir(), "pick-pdf-e2e-"));
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;

  let log = "";
  const child = spawn(
    vp,
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: root,
      env: childEnv({ E2E_PERSIST_DIR: persistDir }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));

  await waitFor(baseURL, child, () => log);
  project.provide("baseURL", baseURL);

  return () => {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    rmSync(persistDir, { recursive: true, force: true });
  };
}
