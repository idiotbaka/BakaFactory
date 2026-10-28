import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { binary, serverRoot } from "./process.mjs";

// Use a temporary database and an available port; never mutate the local database.
const temporaryRoot = resolve(tmpdir());
const directory = await mkdtemp(join(temporaryRoot, "bakafactory-smoke-"));
const socket = createServer();
await new Promise((resolve, reject) => {
  socket.on("error", reject);
  socket.listen(0, "127.0.0.1", resolve);
});
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const url = `http://127.0.0.1:${port}`;
let child;
let output = "";
async function start() {
  child = spawn(binary, [], {
    cwd: serverRoot,
    env: {
      ...process.env,
      APP_ENV: "production",
      APP_VERSION: "smoke-test",
      HTTP_ADDR: `127.0.0.1:${port}`,
      DATABASE_PATH: join(directory, "factory.db"),
      WEB_DIST_DIR: "../web/dist",
      APP_ORIGINS: url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-10000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-10000);
  });
  child.on("error", (error) => {
    output += error.message;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Server exited during startup: ${output}`);
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* Startup can take a moment. */
    }
    await delay(100);
  }
  throw new Error(`Server failed to become ready: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}
try {
  await start();
  for (const path of ["/health", "/api/v1/health"]) {
    const response = await fetch(url + path, {
      headers: { "X-Request-ID": "smoke-request" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "smoke-request");
    assert.deepEqual(await response.json(), {
      status: "ok",
      database: "ok",
      version: "smoke-test",
      environment: "production",
    });
  }
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /BakaFactory · 霓虹工厂/);
  const missing = await fetch(`${url}/api/v1/missing`);
  assert.equal(missing.status, 404);
  assert.equal(
    (await missing.json()).error.request_id,
    missing.headers.get("x-request-id"),
  );
  const method = await fetch(`${url}/health`, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
  const authRequest = (path, method = "GET", body, cookie) =>
    fetch(url + path, {
      method,
      headers: {
        Origin: url,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const credentials = {
    username: "smoke_builder",
    password: "smoke-correct-password",
  };
  const registered = await authRequest(
    "/api/v1/auth/register",
    "POST",
    credentials,
  );
  assert.equal(registered.status, 201);
  const setCookie = registered.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  let cookie = setCookie.split(";")[0];
  const user = (await registered.json()).user;
  assert.equal(user.username, "smoke_builder");
  assert.equal(user.password_hash, undefined);
  const saved = await authRequest(
    "/api/v1/me/profile",
    "PATCH",
    { display_name: "重启后的中文厂长" },
    cookie,
  );
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).user.display_name, "重启后的中文厂长");
  assert.equal(
    (await authRequest("/api/v1/auth/register", "POST", credentials)).status,
    409,
  );
  assert.equal(
    (
      await authRequest("/api/v1/auth/login", "POST", {
        ...credentials,
        password: "wrong-password",
      })
    ).status,
    401,
  );
  const catalog = await authRequest(
    "/api/v1/definitions",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(catalog.status, 200);
  const definitions = await catalog.json();
  assert.equal(definitions.buildings.length, 87);
  assert.equal(definitions.items.length, 353);
  assert.equal(definitions.recipes.length, 332);
  assert.deepEqual(
    definitions.robots.map((robot) => robot.capacity),
    [10, 20, 0, 60, 30, 80, 20, 60, 100],
  );
  assert.equal(
    definitions.buildings.find((building) => building.id === "charge_station")
      .station_transfer_kw,
    1500,
  );
  const heartbeat = async (currentCookie, expected = "") => {
    const response = await authRequest(
      "/api/v1/game/heartbeat",
      "POST",
      { session_id: expected },
      currentCookie,
    );
    assert.equal(response.status, 200);
    return (await response.json()).session_id;
  };
  let sessionID = await heartbeat(cookie);
  const cloudRequest = (
    method,
    body,
    currentCookie = cookie,
    identity = sessionID,
  ) =>
    fetch(url + "/api/v1/game/save", {
      method,
      headers: {
        Origin: url,
        "Content-Type": "application/json",
        Cookie: currentCookie,
        "X-Game-Session": identity,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.deepEqual(await (await cloudRequest("GET")).json(), { backup: null });
  const factory = {
    id: "client-factory",
    owner_id: user.id,
    name: "本机上传的工厂",
    width: 21,
    height: 21,
    created_at: new Date().toISOString(),
    revision: 5,
    buildings: [
      {
        id: "bus",
        factory_id: "client-factory",
        building_type: "bus",
        x: 0,
        y: 0,
        rotation: 0,
        configuration: {},
      },
    ],
    simulation: {
      tick: 5,
      tick_rate: 1,
      buildings: {
        bus: {
          input: [],
          output: [],
          progress: 0,
          duration: 0,
          cooldown: 0,
          status: "warehouse",
        },
      },
      warehouse: { i0002: 12 },
      transfers: [],
    },
  };
  const save = { format_version: 1, rules_version: 1, factory };
  const uploaded = await cloudRequest("PUT", { base_version: 0, save });
  assert.equal(uploaded.status, 200);
  const backup = (await uploaded.json()).backup;
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.save, save);
  assert.equal(
    (await cloudRequest("PUT", { base_version: 0, save })).status,
    409,
  );
  assert.equal(
    (await fetch(url + "/api/v1/factories", { headers: { Cookie: cookie } }))
      .status,
    404,
  );
  // The server only stores this checkpoint; wall-clock time never advances it.
  await delay(1200);
  assert.deepEqual((await (await cloudRequest("GET")).json()).backup, backup);
  await stop();
  await start();
  assert.equal(
    (await authRequest("/api/v1/me", "GET", undefined, cookie)).status,
    200,
  );
  sessionID = await heartbeat(cookie, sessionID);
  assert.deepEqual((await (await cloudRequest("GET")).json()).backup, backup);
  const oldCookie = cookie,
    oldSession = sessionID;
  const loggedIn = await authRequest("/api/v1/auth/login", "POST", credentials);
  assert.equal(loggedIn.status, 200);
  cookie = loggedIn.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await cloudRequest(
        "PUT",
        { base_version: 1, save },
        oldCookie,
        oldSession,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await authRequest(
        "/api/v1/game/heartbeat",
        "POST",
        { session_id: oldSession },
        cookie,
      )
    ).status,
    401,
  );
  sessionID = await heartbeat(cookie);
  assert.deepEqual((await (await cloudRequest("GET")).json()).backup, backup);
  assert.equal(
    (await cloudRequest("PUT", { base_version: 1, save })).status,
    200,
  );
  assert.equal(
    (await authRequest("/api/v1/auth/logout", "POST", undefined, cookie))
      .status,
    204,
  );
  assert.equal((await cloudRequest("GET")).status, 401);
  console.log(
    "Smoke checks passed: single-login revocation, sole cloud save, stale-write rejection, restart persistence and no server production. Client production is covered separately by web tests and browser acceptance.",
  );
} finally {
  await stop();
  // Verify the generated target before any recursive removal on Windows.
  assert.equal(dirname(resolve(directory)), temporaryRoot);
  assert.ok(basename(directory).startsWith("bakafactory-smoke-"));
  await rm(directory, { recursive: true, force: true });
}
