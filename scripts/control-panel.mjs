import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openSync, closeSync } from "node:fs";
import { readFile, mkdir, open } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSettings, saveSettings } from "./host-settings.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function createControlPanel({
  root = projectRoot,
  panelPort = 9090,
} = {}) {
  const runtime = path.join(root, ".selfhost");
  const settingsFile = path.join(runtime, "settings.json");
  await mkdir(runtime, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const origins = new Set([
    `http://localhost:${panelPort}`,
    `http://127.0.0.1:${panelPort}`,
  ]);
  const hosts = new Set([`localhost:${panelPort}`, `127.0.0.1:${panelPort}`]);
  let busy = null;
  let lastError = null;
  let child = null;
  let sequence = 0;
  async function control() {
    return JSON.parse(
      await readFile(path.join(runtime, "control.json"), "utf8"),
    );
  }
  async function gateway(endpoint, method = "GET", body) {
    const c = await control();
    const response = await fetch(
      `http://127.0.0.1:${c.port}/selfhost/${endpoint}`,
      {
        method,
        headers: {
          authorization: `Bearer ${c.token}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Game gateway answered ${response.status}. Restart it to load panel support.`,
      );
    return response.json();
  }
  async function status() {
    const settings = await loadSettings(settingsFile);
    let metrics = null;
    let running = false;
    try {
      metrics = await gateway("stats");
      running = true;
    } catch {
      try {
        running = (await gateway("health")).online === true;
      } catch {}
    }
    let published = null;
    try {
      published = JSON.parse(
        await readFile(
          path.join(
            process.env.ARCADE_SITE_REPO || "F:/GithubRepo/gabe9230.github.io",
            "Arcade/openfront/server.json",
          ),
          "utf8",
        ),
      ).serverUrl;
    } catch {}
    return {
      running,
      busy,
      lastError,
      metrics,
      settings,
      published,
      restartRequired:
        running &&
        (!metrics ||
          metrics.port !== settings.port ||
          metrics.workers !== settings.workers ||
          metrics.shared !== settings.share),
      panelMemory: process.memoryUsage().rss,
    };
  }
  async function start() {
    if ((await status()).running) return;
    const settings = await loadSettings(settingsFile);
    lastError = null;
    const log = openSync(path.join(runtime, "panel-launcher.log"), "a");
    const id = ++sequence;
    child = spawn(
      process.execPath,
      [
        path.join(root, "scripts/selfhost.mjs"),
        ...(settings.share ? ["--share"] : []),
      ],
      {
        cwd: root,
        env: { ...process.env, SELFHOST_PORT: String(settings.port) },
        windowsHide: true,
        detached: true,
        stdio: ["ignore", log, log],
      },
    );
    closeSync(log);
    let failed = false;
    child.once("error", (error) => {
      failed = true;
      lastError = error.message;
    });
    child.once("exit", (code) => {
      if (code && id === sequence) {
        failed = true;
        lastError = `Game exited with code ${code}. See Launcher logs.`;
      }
    });
    child.unref();
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failed) throw new Error(lastError);
      if ((await status()).running) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Game startup timed out. See Launcher logs for the cause.");
  }
  async function stop() {
    const before = await status();
    if (!before.running) return;
    const ports = [
      3000,
      ...Array.from(
        { length: before.metrics?.workers || 2 },
        (_, i) => 3001 + i,
      ),
    ];
    ++sequence;
    await gateway("stop", "POST");
    for (let i = 0; i < 80; i++) {
      if (!(await status()).running) {
        const occupied = await Promise.all(
          ports.map(
            (port) =>
              new Promise((resolve) => {
                const socket = net.connect(port, "127.0.0.1");
                socket.setTimeout(500);
                socket.once("connect", () => {
                  socket.destroy();
                  resolve(true);
                });
                socket.once("error", () => resolve(false));
                socket.once("timeout", () => {
                  socket.destroy();
                  resolve(false);
                });
              }),
          ),
        );
        if (!occupied.some(Boolean)) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Game is still stopping. Check Launcher logs.");
  }
  async function publish() {
    const s = await status();
    if (!s.running || !s.metrics?.publicUrl)
      throw new Error(
        "Start the public tunnel and wait for its address before publishing.",
      );
    const log = openSync(path.join(runtime, "publish.log"), "a");
    const publisher = spawn(
      process.execPath,
      [path.join(root, "scripts/publish-host-endpoint.mjs")],
      { cwd: root, windowsHide: true, stdio: ["ignore", log, log] },
    );
    closeSync(log);
    await new Promise((resolve, reject) => {
      publisher.once("error", reject);
      publisher.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                "Publishing failed. Check Publish logs and your GitHub sign-in.",
              ),
            ),
      );
    });
  }
  function json(res, code, value) {
    res.writeHead(code, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 16384) throw new Error("Request too large.");
    }
    return JSON.parse(data || "{}");
  }
  const assets = {
    "/": ["index.html", "text/html"],
    "/panel.js": ["panel.js", "text/javascript"],
    "/panel.css": ["panel.css", "text/css"],
  };
  const logFiles = {
    server: "server.log",
    tunnel: "tunnel.log",
    launcher: "panel-launcher.log",
    publish: "publish.log",
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    if (!hosts.has(req.headers.host))
      return json(res, 403, { error: "Local control panel only." });
    try {
      const url = new URL(req.url, `http://127.0.0.1:${panelPort}`);
      if (req.method === "GET" && assets[url.pathname]) {
        const [file, mime] = assets[url.pathname];
        if (url.pathname === "/")
          res.setHeader(
            "Set-Cookie",
            `of_panel=${token}; HttpOnly; SameSite=Strict; Path=/`,
          );
        res.setHeader("Content-Type", mime);
        return res.end(
          await readFile(path.join(root, "deployment/control-panel", file)),
        );
      }
      if (
        !(req.headers.cookie || "")
          .split(";")
          .some((c) => c.trim() === `of_panel=${token}`)
      )
        return json(res, 401, { error: "Open the local panel first." });
      if (
        req.method !== "GET" &&
        (!origins.has(req.headers.origin) ||
          req.headers["x-panel-request"] !== "1")
      )
        return json(res, 403, {
          error: "This action must come from the local panel.",
        });
      if (url.pathname === "/api/status" && req.method === "GET")
        return json(res, 200, await status());
      if (url.pathname === "/api/logs" && req.method === "GET") {
        const file = logFiles[url.searchParams.get("source") || "server"];
        if (!file) return json(res, 400, { error: "Unknown log source." });
        let text = "";
        try {
          const handle = await open(path.join(runtime, file), "r");
          try {
            const { size } = await handle.stat();
            const count = Math.min(size, 65536);
            const buffer = Buffer.alloc(count);
            await handle.read(buffer, 0, count, size - count);
            text = buffer.toString("utf8");
            if (size > count) text = text.slice(text.indexOf("\n") + 1);
          } finally {
            await handle.close();
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return json(res, 200, {
          text: text.split(/\r?\n/).slice(-180).join("\n"),
        });
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (busy)
          return json(res, 409, { error: `Wait for ${busy} to finish.` });
        const action = url.pathname.slice(5);
        if (
          !["start", "stop", "restart", "settings", "publish"].includes(action)
        )
          return json(res, 404, { error: "Not found" });
        busy = action;
        try {
          if (action === "settings") {
            const next = await saveSettings(settingsFile, await body(req));
            if ((await status()).running) {
              try {
                await gateway("settings", "POST", next);
              } catch (error) {
                lastError = error.message;
              }
            }
          } else if (action === "restart") {
            await stop();
            await start();
          } else if (action === "start") await start();
          else if (action === "stop") await stop();
          else await publish();
          lastError = null;
          return json(res, 200, { ok: true });
        } finally {
          busy = null;
        }
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      lastError = error.message;
      json(res, 400, { error: error.message });
    }
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const openBrowser = () => {
    if (process.argv.includes("--no-open")) return;
    const browser =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/c", "start", "", "http://localhost:9090"], {
            windowsHide: true,
            stdio: "ignore",
          })
        : spawn(
            process.platform === "darwin" ? "open" : "xdg-open",
            ["http://localhost:9090"],
            { stdio: "ignore" },
          );
    browser.on("error", () =>
      console.log("Open http://localhost:9090 in your browser."),
    );
    browser.unref();
  };
  const server = await createControlPanel();
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? "The panel is already running at http://localhost:9090"
        : error.message,
    );
    if (error.code === "EADDRINUSE") openBrowser();
    process.exitCode = 1;
  });
  server.listen(9090, "127.0.0.1", () => {
    console.log("OpenFront control panel: http://localhost:9090");
    console.log("Closing the browser does not stop the panel or the game.");
    openBrowser();
  });
}
