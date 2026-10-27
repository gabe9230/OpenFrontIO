import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlPanel } from "../scripts/control-panel.mjs";
import {
  validateSettings,
  defaultSettings,
} from "../scripts/host-settings.mjs";
import { loadSelfHostDefaults } from "../src/server/SelfHostDefaults.ts";

test("settings reject unsafe limits and strip executable/environment input", () => {
  for (const patch of [
    { workers: 0 },
    { workers: 9 },
    { port: 3001 },
    { port: 9090 },
    { maxConnections: -1 },
    { defaults: { bots: 401 } },
    { defaults: { nations: 0 } },
    { defaults: { difficulty: "arbitrary" } },
    { defaults: { startingGold: -1 } },
  ])
    assert.throws(() => validateSettings(patch));
  assert.equal(
    validateSettings({ executable: "arbitrary", env: { API_KEY: "bad" } })
      .executable,
    undefined,
  );
  assert.equal(validateSettings({}).defaults.nations, "default");
});

test("panel requires a local host, authenticated cookie, and same-origin mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openfront-panel-test-"));
  await mkdir(path.join(root, "deployment"), { recursive: true });
  await cp(
    new URL("../deployment/control-panel", import.meta.url),
    path.join(root, "deployment/control-panel"),
    { recursive: true },
  );
  const server = await createControlPanel({ root, panelPort: 19090 });
  await new Promise((resolve) => server.listen(19090, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:19090";
  try {
    assert.equal((await fetch(base + "/api/status")).status, 401);
    const hostileHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(
        base + "/",
        { headers: { host: "evil.example:19090" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on("error", reject);
    });
    assert.equal(hostileHostStatus, 403);
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    assert.ok(page.headers.get("set-cookie").includes("SameSite=Strict"));
    const headers = {
      cookie,
      "content-type": "application/json",
      "x-panel-request": "1",
      origin: base,
    };
    assert.equal(
      (
        await fetch(base + "/api/settings", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/settings", {
          method: "POST",
          headers,
          body: '{"workers":999}',
        })
      ).status,
      400,
    );
    const changed = {
      ...defaultSettings,
      workers: 1,
      defaults: {
        ...defaultSettings.defaults,
        bots: 27,
        nations: "disabled",
        goldMultiplier: 2.5,
      },
    };
    assert.equal(
      (
        await fetch(base + "/api/settings", {
          method: "POST",
          headers,
          body: JSON.stringify(changed),
        })
      ).status,
      200,
    );
    const status = await fetch(base + "/api/status", {
      headers: { cookie },
    }).then((r) => r.json());
    assert.equal(status.running, false);
    assert.equal(status.settings.defaults.bots, 27);
    assert.equal(status.settings.workers, 1);
    assert.equal(status.token, undefined);
    const file = path.join(root, ".selfhost/settings.json");
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).defaults.goldMultiplier,
      2.5,
    );
    assert.equal(
      (
        await fetch(base + "/api/logs?source=../../secret", {
          headers: { cookie },
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("the game's new-lobby defaults read current saved values without changing global rules", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "openfront-defaults-test-"),
  );
  const file = path.join(root, "settings.json");
  const previous = process.env.SELFHOST_SETTINGS_PATH;
  try {
    delete process.env.SELFHOST_SETTINGS_PATH;
    assert.deepEqual(await loadSelfHostDefaults(), {});
    process.env.SELFHOST_SETTINGS_PATH = file;
    await writeFile(
      file,
      JSON.stringify({
        defaults: {
          bots: 12,
          nations: "disabled",
          difficulty: "Hard",
          startingGold: 500,
          goldMultiplier: 2,
        },
      }),
    );
    assert.equal((await loadSelfHostDefaults()).bots, 12);
    await writeFile(file, JSON.stringify({ defaults: { bots: 34 } }));
    assert.deepEqual(await loadSelfHostDefaults(), { bots: 34 });
    await writeFile(file, JSON.stringify({ defaults: { bots: 9999 } }));
    await assert.rejects(loadSelfHostDefaults());
  } finally {
    if (previous === undefined) delete process.env.SELFHOST_SETTINGS_PATH;
    else process.env.SELFHOST_SETTINGS_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
});
