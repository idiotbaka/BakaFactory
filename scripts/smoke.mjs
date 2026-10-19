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
  assert.equal(definitions.buildings.length, 7);
  assert.equal(definitions.items.length, 3);
  assert.equal(definitions.recipes.length, 3);
  const initialFactories = await authRequest(
    "/api/v1/factories",
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual((await initialFactories.json()).factories, []);
  const factoryResponse = await authRequest(
    "/api/v1/factories",
    "POST",
    { name: "重启后的中文工厂" },
    cookie,
  );
  assert.equal(factoryResponse.status, 201);
  let factory = (await factoryResponse.json()).factory;
  assert.equal(factory.width, 21);
  assert.equal(factory.height, 21);
  assert.equal(factory.owner_id, user.id);
  assert.equal(factory.buildings.length, 1);
  assert.equal(factory.buildings[0].building_type, "bus");
  assert.equal(factory.buildings[0].x, 0);
  assert.equal(factory.buildings[0].y, 0);
  assert.equal(
    (
      await authRequest(
        "/api/v1/factories",
        "POST",
        { name: "不应创建第二座" },
        cookie,
      )
    ).status,
    409,
  );
  const buildingsPath = `/api/v1/factories/${factory.id}/buildings`;
  const editableTypes = definitions.buildings.filter((b) => !b.fixed);
  for (let i = 0; i < 36; i++) {
    const placed = await authRequest(
      buildingsPath,
      "POST",
      {
        building_type: editableTypes[i % editableTypes.length].id,
        x: -6 + (i % 6),
        y: 1 + Math.floor(i / 6),
        rotation: (i % 4) * 90,
      },
      cookie,
    );
    assert.equal(placed.status, 201);
    factory = (await placed.json()).factory;
  }
  assert.equal(factory.buildings.length, 37);
  const movable = factory.buildings.find((b) => b.building_type !== "bus");
  const moved = await authRequest(
    `${buildingsPath}/${movable.id}`,
    "PATCH",
    { x: -10, y: -10, rotation: 270 },
    cookie,
  );
  assert.equal(moved.status, 200);
  factory = (await moved.json()).factory;
  assert.deepEqual(
    { ...factory.buildings.find((b) => b.id === movable.id) },
    { ...movable, x: -10, y: -10, rotation: 270 },
  );
  const removable = factory.buildings.find(
    (b) => b.building_type !== "bus" && b.id !== movable.id,
  );
  const deleted = await authRequest(
    `${buildingsPath}/${removable.id}`,
    "DELETE",
    undefined,
    cookie,
  );
  assert.equal(deleted.status, 200);
  factory = (await deleted.json()).factory;
  assert.equal(factory.buildings.length, 36);
  assert.equal(
    (
      await authRequest(
        buildingsPath,
        "POST",
        { building_type: "miner", x: 0, y: 0, rotation: 0 },
        cookie,
      )
    ).status,
    409,
  );
  const busID = factory.buildings.find((b) => b.building_type === "bus").id;
  assert.equal(
    (
      await authRequest(
        `${buildingsPath}/${busID}`,
        "DELETE",
        undefined,
        cookie,
      )
    ).status,
    409,
  );
  // Build a full ore → plate → gear line on the otherwise empty center row.
  const productionLine = [
    "miner",
    "item_output",
    "conveyor",
    "item_input",
    "furnace",
    "item_output",
    "conveyor",
    "item_input",
    "assembler",
    "item_output",
  ];
  for (const [i, kind] of productionLine.entries()) {
    const placed = await authRequest(
      buildingsPath,
      "POST",
      { building_type: kind, x: -10 + i, y: 0, rotation: 0 },
      cookie,
    );
    assert.equal(placed.status, 201);
    factory = (await placed.json()).factory;
  }
  const productionDeadline = Date.now() + 25000;
  while (
    (factory.simulation.warehouse.gear ?? 0) < 1 &&
    Date.now() < productionDeadline
  ) {
    await delay(250);
    const snapshot = await authRequest(
      `/api/v1/factories/${factory.id}`,
      "GET",
      undefined,
      cookie,
    );
    assert.equal(snapshot.status, 200);
    factory = (await snapshot.json()).factory;
  }
  assert.ok(
    factory.simulation.warehouse.gear >= 1,
    "production chain did not deliver a gear within 25 seconds",
  );
  await stop();
  await start();
  assert.equal((await fetch(`${url}/health`)).status, 200);
  const restored = await authRequest("/api/v1/me", "GET", undefined, cookie);
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).user.display_name, "重启后的中文厂长");
  const restoredFactory = await authRequest(
    `/api/v1/factories/${factory.id}`,
    "GET",
    undefined,
    cookie,
  );
  assert.equal(restoredFactory.status, 200);
  const restoredSnapshot = (await restoredFactory.json()).factory;
  const layout = ({ simulation, revision, ...saved }) => saved;
  assert.deepEqual(layout(restoredSnapshot), layout(factory));
  assert.ok(restoredSnapshot.simulation.tick >= factory.simulation.tick);
  for (const [item, count] of Object.entries(factory.simulation.warehouse)) {
    assert.ok(
      (restoredSnapshot.simulation.warehouse[item] ?? 0) >= count,
      "warehouse contents lost on restart",
    );
  }
  assert.equal(
    (await authRequest("/api/v1/auth/logout", "POST", undefined, cookie))
      .status,
    204,
  );
  assert.equal(
    (await authRequest("/api/v1/me", "GET", undefined, cookie)).status,
    401,
  );
  const loggedIn = await authRequest("/api/v1/auth/login", "POST", credentials);
  assert.equal(loggedIn.status, 200);
  assert.equal((await loggedIn.json()).user.display_name, "重启后的中文厂长");
  cookie = loggedIn.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await authRequest("/api/v1/me", "GET", undefined, cookie)).status,
    200,
  );
  const factoryList = await authRequest(
    "/api/v1/factories",
    "GET",
    undefined,
    cookie,
  );
  const summaries = (await factoryList.json()).factories;
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, factory.id);
  console.log(
    "Smoke checks passed: building edits, complete ore/plate/gear production and logistics, Bus warehouse delivery, and persistence across restart and relogin.",
  );
} finally {
  await stop();
  // Verify the generated target before any recursive removal on Windows.
  assert.equal(dirname(resolve(directory)), temporaryRoot);
  assert.ok(basename(directory).startsWith("bakafactory-smoke-"));
  await rm(directory, { recursive: true, force: true });
}
