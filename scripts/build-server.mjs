import { mkdir } from "node:fs/promises";
import { run, root, serverRoot, binary } from "./process.mjs";
await mkdir(`${root}/dist`, { recursive: true });
await run("go", ["build", "-trimpath", "-o", binary, "./cmd/server"], {
  cwd: serverRoot,
});
