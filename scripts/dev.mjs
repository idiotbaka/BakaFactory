import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { run, root, serverRoot } from "./process.mjs";
const binary = fileURLToPath(
  new URL(
    `../.runtime/server${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
await run(process.execPath, ["scripts/generate-search-index.mjs"], {
  cwd: root,
});
await mkdir(`${root}/.runtime`, { recursive: true });
await run("go", ["build", "-o", binary, "./cmd/server"], { cwd: serverRoot });
const backend = spawn(binary, [], {
  cwd: serverRoot,
  stdio: "inherit",
  env: { ...process.env, APP_ENV: process.env.APP_ENV ?? "local" },
});
let web;
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  await web?.close();
  backend.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => void close(0));
process.on("SIGTERM", () => void close(0));
backend.on("error", (error) => {
  console.error(error);
  void close(1);
});
backend.on("exit", (code) => {
  if (!closing) void close(code || 1);
});
try {
  web = await createServer({ root: `${root}/apps/web` });
  if (closing) await web.close();
  else {
    await web.listen();
    web.printUrls();
  }
} catch (error) {
  console.error(error);
  await close(1);
}
