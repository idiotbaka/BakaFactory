import { run, serverRoot, binary } from "./process.mjs";
await run(binary, [], {
  cwd: serverRoot,
  env: {
    ...process.env,
    APP_ENV: process.env.APP_ENV ?? "production",
    WEB_DIST_DIR: process.env.WEB_DIST_DIR ?? "../web/dist",
  },
});
