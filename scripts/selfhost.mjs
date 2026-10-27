import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, createWriteStream } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSettings,
  saveSettings,
  validateSettings,
} from "./host-settings.mjs";
import { routeRequest, selfhostHtml } from "./selfhost-routing.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(root, ".selfhost");
const settingsFile = path.join(runtime, "settings.json");
let settings = await loadSettings(settingsFile);
await saveSettings(settingsFile, settings);
const port = Number(process.env.SELFHOST_PORT || settings.port);
const workers = settings.workers;
const share = process.argv.includes("--share");
const children = [];
const sockets = new Set();
const gameSockets = new Set();
const startedAt = Date.now();
let publicUrl = null;
let requests = 0;
let errors = 0;
let closedBytesIn = 0;
let closedBytesOut = 0;
let totalLatency = 0;
const stopToken = randomBytes(32).toString("hex");
let stopping = false;
await mkdir(runtime, { recursive: true });
if (!existsSync(path.join(root, "static/asset-hashes.json"))) {
  throw new Error("Build the game first: npm run build-prod");
}
// Refuse occupied upstream ports rather than exposing an unrelated service.
for (const p of [
  port,
  3000,
  ...Array.from({ length: workers }, (_, i) => 3001 + i),
]) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () =>
      reject(
        new Error(`Port ${p} is busy. Stop the other game launcher first.`),
      ),
    );
    probe.listen(p, "127.0.0.1", () => probe.close(resolve));
  });
}
const version = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const env = {
  ...process.env,
  GAME_ENV: "dev",
  DOMAIN: "localhost",
  GIT_COMMIT: version,
  NUM_WORKERS: String(workers),
  SELFHOST_SETTINGS_PATH: settingsFile,
  INSTANCE_LETTER: "a",
  LOBBY_COORDINATOR: "off",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  API_KEY: randomBytes(32).toString("hex"),
  ADMIN_BOT_API_KEY: randomBytes(32).toString("hex"),
  // Never register this independent server with the official OpenFront service.
  GAME_HOST: "",
  SUBDOMAIN: "",
  SITE_HOST: "",
  GAME_DOMAIN: "",
  CDN_BASE: "",
};
const log = createWriteStream(path.join(runtime, "server.log"), { flags: "a" });
const game = spawn(
  process.execPath,
  ["--import", "tsx", "src/server/Server.ts"],
  {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
children.push(game);
game.stdout.pipe(log, { end: false });
game.stderr.pipe(log, { end: false });
game.on("exit", (code) => {
  if (!stopping) {
    console.error(`Game server exited (${code}). See .selfhost/server.log`);
    stop(1);
  }
});

async function ready(p) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (
      await new Promise((resolve) => {
        const socket = net.connect(p, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      })
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Server on port ${p} did not start. See .selfhost/server.log`,
  );
}

const bridge = await readFile(path.join(root, "scripts/selfhost-bridge.js"));
function json(res, code, data) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}
const gateway = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/selfhost/")) {
    requests++;
    const begin = performance.now();
    res.once("finish", () => {
      totalLatency += performance.now() - begin;
      if (res.statusCode >= 500) errors++;
    });
  }
  if (["/selfhost/stats", "/selfhost/settings"].includes(url.pathname)) {
    if (req.headers.authorization !== `Bearer ${stopToken}`)
      return json(res, 404, { error: "Not found" });
    if (url.pathname === "/selfhost/stats" && req.method === "GET") {
      void Promise.all(
        Array.from({ length: workers }, (_, i) =>
          fetch(`http://127.0.0.1:${3001 + i}/api/selfhost/snapshot`, {
            headers: { "x-api-key": env.API_KEY },
            signal: AbortSignal.timeout(1500),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      )
        .then((snapshots) => {
          const totals = {
            games: 0,
            clients: 0,
            publicLobbies: 0,
            listedLobbies: 0,
          };
          for (const snapshot of snapshots)
            if (snapshot)
              for (const key of Object.keys(totals))
                totals[key] += snapshot[key];
          json(res, 200, {
            startedAt,
            uptime: (Date.now() - startedAt) / 1000,
            port,
            workers,
            shared: share,
            publicUrl,
            requests,
            errors,
            bytesIn:
              closedBytesIn + [...sockets].reduce((n, s) => n + s.bytesRead, 0),
            bytesOut:
              closedBytesOut +
              [...sockets].reduce((n, s) => n + s.bytesWritten, 0),
            connections: gameSockets.size,
            memory: process.memoryUsage().rss,
            averageLatency: requests ? totalLatency / requests : 0,
            workerHealth: snapshots.map(Boolean),
            ...totals,
            settings,
          });
        })
        .catch((error) => json(res, 500, { error: error.message }));
      return;
    }
    if (url.pathname === "/selfhost/settings" && req.method === "POST") {
      void (async () => {
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 16384)
              throw new Error("Settings request too large.");
          }
          const next = validateSettings(JSON.parse(body));
          await saveSettings(settingsFile, next);
          settings = next;
          json(res, 200, {
            saved: true,
            restartRequired:
              next.port !== port ||
              next.workers !== workers ||
              next.share !== share,
          });
        } catch (error) {
          json(res, 400, { error: error.message });
        }
      })();
      return;
    }
    return json(res, 405, { error: "Method not allowed" });
  }
  if (url.pathname === "/selfhost/stop") {
    if (
      req.method !== "POST" ||
      req.headers.authorization !== `Bearer ${stopToken}`
    )
      return json(res, 404, { error: "Not found" });
    json(res, 200, { stopping: true });
    res.once("finish", () => setImmediate(() => stop()));
    return;
  }
  if (url.pathname === "/selfhost/health") {
    if (
      [
        "https://gabrielhalloran.org",
        "https://www.gabrielhalloran.org",
        "https://gabe9230.github.io",
        "http://localhost:9081",
      ].includes(req.headers.origin)
    ) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
    }
    return json(res, 200, { online: true, version, workers });
  }
  if (url.pathname === "/selfhost-bridge.js") {
    res.writeHead(200, {
      "content-type": "text/javascript",
      "cache-control": "no-store",
    });
    return res.end(bridge);
  }
  // The optional official account/store API is not part of the open source
  // server. Answer locally so guests never call their own localhost:8787.
  if (url.pathname.startsWith("/selfhost-api/")) {
    if (url.pathname.endsWith("/cluster.json"))
      return json(res, 200, { servers: {} });
    // A 401 refresh makes upstream Auth clear the guest's persistent identity.
    // A missing account service must preserve that ID for lobby rejoining.
    if (/\/(?:auth|users)\//.test(url.pathname))
      return json(res, 404, { error: "Guest-only self-hosted server" });
    return json(res, 404, {
      error: "Official account services are not available on this server",
    });
  }
  const route = routeRequest(req.url, req.method, workers);
  if (!route) return json(res, 404, { error: "Not found" });
  if (
    req.method === "POST" &&
    route.path.startsWith("/api/create_game") &&
    !settings.allowNewLobbies
  )
    return json(res, 503, {
      error: "New lobbies are temporarily disabled by the server operator.",
    });
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: route.port,
      path: route.path,
      method: req.method,
      headers: { ...req.headers, "accept-encoding": "identity" },
    },
    (response) => {
      if (String(response.headers["content-type"]).includes("text/html")) {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const html = selfhostHtml(Buffer.concat(chunks).toString("utf8"));
          const headers = {
            ...response.headers,
            "content-length": Buffer.byteLength(html),
            "cache-control": "no-store",
          };
          delete headers["transfer-encoding"];
          delete headers.etag;
          res.writeHead(response.statusCode, headers);
          res.end(html);
        });
      } else {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
      response.on("error", () => res.destroy());
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) json(res, 502, { error: "Game server unavailable" });
    else res.destroy();
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
});
gateway.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => {
    closedBytesIn += socket.bytesRead;
    closedBytesOut += socket.bytesWritten;
    sockets.delete(socket);
    gameSockets.delete(socket);
  });
});
gateway.on("upgrade", (req, socket, head) => {
  const route = routeRequest(req.url, "GET", workers);
  if (!route || !/^\/(?:w\d+(?:\/lobbies)?|lobbies)(?:\?|$)/.test(req.url))
    return socket.destroy();
  if (gameSockets.size >= settings.maxConnections) {
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  gameSockets.add(socket);
  const upstream = http.request({
    host: "127.0.0.1",
    port: route.port,
    path: route.path,
    headers: req.headers,
  });
  upstream.on("upgrade", (response, remote, remoteHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\r\n")}\r\n\r\n`,
    );
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    remote.on("error", () => socket.destroy());
    socket.on("error", () => remote.destroy());
    socket.on("close", () => remote.destroy());
    remote.on("close", () => socket.destroy());
  });
  upstream.on("response", () => socket.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  upstream.end();
});

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of sockets) socket.destroy();
  gateway.close();
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {}
    } else child.kill("SIGTERM");
  }
  log.end();
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
process.on("uncaughtException", (error) => {
  console.error(error.message);
  stop(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  stop(1);
});
await Promise.all(
  [3000, ...Array.from({ length: workers }, (_, i) => 3001 + i)].map(ready),
);
await new Promise((resolve) => gateway.listen(port, "127.0.0.1", resolve));
await writeFile(
  path.join(runtime, "control.json"),
  JSON.stringify({ port, token: stopToken, pid: process.pid }),
  { mode: 0o600 },
);
console.log(`OpenFront on your PC: http://localhost:${port}`);
console.log(
  "Keep this launcher running. Press Ctrl+C to stop the game and tunnel.",
);

if (share) {
  const executable =
    process.env.CLOUDFLARED_PATH ||
    path.join(
      runtime,
      process.platform === "win32" ? "cloudflared.exe" : "cloudflared",
    );
  if (!existsSync(executable))
    throw new Error("Install cloudflared first (see docs/SelfHosting.md).");
  const tunnel = spawn(
    executable,
    [
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      `http://127.0.0.1:${port}`,
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.push(tunnel);
  let reported = false;
  const tunnelLog = createWriteStream(path.join(runtime, "tunnel.log"), {
    flags: "a",
  });
  for (const stream of [tunnel.stdout, tunnel.stderr])
    stream.on("data", async (chunk) => {
      tunnelLog.write(chunk);
      const match = chunk
        .toString()
        .match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!match || reported) return;
      reported = true;
      const endpoint = {
        serverUrl: match[0],
        updatedAt: new Date().toISOString(),
      };
      publicUrl = match[0];
      await writeFile(
        path.join(runtime, "endpoint.json"),
        JSON.stringify(endpoint, null, 2) + "\n",
      );
      console.log(`Public game address: ${match[0]}`);
      console.log("Publish this address to the arcade: npm run host:publish");
    });
  tunnel.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `Tunnel stopped (${code}); public access is offline. See .selfhost/tunnel.log`,
      );
      stop(1);
    }
  });
  tunnel.on("error", (error) => {
    throw error;
  });
}
