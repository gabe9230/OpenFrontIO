const $ = (selector) => document.querySelector(selector);
const form = $("#settings-form");
let snapshot = null;
let dirty = false;
let actionPending = false;
let derivedNotice = null;
let lastSample = null;
const history = [];
const bytes = (value) => {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
};
const duration = (seconds) => {
  const n = Math.floor(seconds || 0);
  return n >= 3600
    ? `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
    : `${Math.floor(n / 60)}m ${n % 60}s`;
};
function notify(text, error = false) {
  $("#notice").textContent = text;
  $("#notice").classList.toggle("error", error);
  $("#notice").hidden = !text;
}
async function api(path, data) {
  const response = await fetch(
    `/api/${path}`,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-panel-request": "1",
          },
          body: JSON.stringify(data),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}
function fillSettings(settings) {
  for (const key of ["port", "workers", "maxConnections"])
    form.elements[key].value = settings[key];
  for (const key of ["share", "allowNewLobbies"])
    form.elements[key].checked = settings[key];
  for (const key of ["bots", "difficulty", "goldMultiplier", "startingGold"])
    form.elements[key].value = settings.defaults[key];
  const nations = settings.defaults.nations;
  form.elements.nationMode.value =
    typeof nations === "number" ? "custom" : nations;
  form.elements.nationCount.hidden = typeof nations !== "number";
  if (typeof nations === "number") form.elements.nationCount.value = nations;
}
function readSettings() {
  const value = (name) => Number(form.elements[name].value);
  const nationMode = form.elements.nationMode.value;
  return {
    port: value("port"),
    workers: value("workers"),
    maxConnections: value("maxConnections"),
    share: form.elements.share.checked,
    allowNewLobbies: form.elements.allowNewLobbies.checked,
    defaults: {
      bots: value("bots"),
      nations: nationMode === "custom" ? value("nationCount") : nationMode,
      difficulty: form.elements.difficulty.value,
      goldMultiplier: value("goldMultiplier"),
      startingGold: value("startingGold"),
    },
  };
}
function drawChart(value) {
  history.push(value);
  if (history.length > 60) history.shift();
  const max = Math.max(1024, ...history);
  const points = history.map(
    (v, i) => `${(i * 900) / 59},${120 - (v / max) * 110}`,
  );
  const line = points.length ? `M${points.join(" L")}` : "";
  $("#chart-line").setAttribute("d", line);
  $("#chart-area").setAttribute(
    "d",
    points.length
      ? `${line} L${((points.length - 1) * 900) / 59},125 L0,125 Z`
      : "",
  );
}
function render(s) {
  snapshot = s;
  const m = s.metrics;
  const busy = actionPending || Boolean(s.busy);
  $("#connection").textContent = s.running
    ? "● Server online"
    : "○ Server stopped";
  $("#connection").classList.toggle("online", s.running);
  $("#server-title").textContent = busy
    ? `Working${s.busy ? `: ${s.busy}` : ""}…`
    : s.running
      ? "Your world is online"
      : "Ready when you are";
  $("#server-detail").textContent = s.running
    ? m
      ? `Gateway on localhost:${m.port} · ${m.workerHealth.filter(Boolean).length}/${m.workers} workers healthy`
      : "Existing server detected. Restart once to enable monitoring."
    : "Start the server to open lobbies for players.";
  $("#start").disabled = busy || s.running;
  $("#stop").disabled = busy || !s.running;
  $("#restart").disabled = busy || !s.running;
  $("#publish").disabled =
    busy || !m?.publicUrl || m?.publication?.state === "publishing";
  $("#copy-endpoint").disabled = !m?.publicUrl;
  $("#endpoint").textContent =
    m?.publicUrl ||
    (s.running && (m ? m.shared : s.settings.share)
      ? "Waiting for tunnel…"
      : s.running
        ? "Local only"
        : "Not connected");
  if (m?.publicUrl) $("#endpoint").href = m.publicUrl;
  else $("#endpoint").removeAttribute("href");
  $("#clients").textContent = m ? m.clients : "—";
  $("#connections").textContent = m
    ? `${m.connections} WebSocket connections / ${s.settings.maxConnections} limit`
    : "No monitoring data";
  $("#uptime").textContent = m ? duration(m.uptime) : "—";
  $("#workers").textContent = m
    ? `${m.workers} game worker${m.workers === 1 ? "" : "s"} running`
    : "No workers running";
  $("#bandwidth").textContent = m ? bytes(m.bytesIn + m.bytesOut) : "—";
  $("#memory").textContent = m ? bytes(m.memory) : "—";
  $("#latency").textContent = m
    ? `${m.averageLatency.toFixed(1)} ms average HTTP response`
    : "Gateway process memory";
  $("#requests").textContent = `${m?.requests ?? 0} HTTP requests`;
  $("#games").textContent = `${m?.games ?? 0} games tracked`;
  $("#errors").textContent = `${m?.errors ?? 0} server errors`;
  let rate = 0;
  if (m && lastSample?.startedAt === m.startedAt)
    rate = Math.max(
      0,
      (m.bytesIn + m.bytesOut - lastSample.bytes) /
        ((Date.now() - lastSample.at) / 1000),
    );
  lastSample = m
    ? { at: Date.now(), bytes: m.bytesIn + m.bytesOut, startedAt: m.startedAt }
    : null;
  $("#traffic-rate").textContent = `${bytes(rate)}/s · upload + download`;
  drawChart(rate);
  if (!dirty) fillSettings(s.settings);
  $("#settings-state").textContent = dirty
    ? "Unsaved changes"
    : s.restartRequired
      ? "Restart required"
      : "Saved locally";
  if (!actionPending) {
    const next =
      s.lastError ||
      (s.restartRequired
        ? "Saved host settings will take effect after a restart. Restarting ends active matches."
        : m?.publication?.state === "publishing"
          ? "Automatically publishing the new server address to the arcade…"
          : m?.publication?.state === "failed"
            ? m.publication.error
            : m?.publicUrl && s.published !== m.publicUrl
              ? "Updating the arcade address automatically. Update arcade address can retry a failed publication."
              : null);
    if (next) notify(next, Boolean(s.lastError));
    else if (derivedNotice) notify("");
    derivedNotice = next;
  }
}
async function refreshLogs() {
  if ($("#log-paused").checked) return;
  const output = $("#log-output");
  const atBottom =
    output.scrollHeight - output.scrollTop - output.clientHeight < 60;
  const value = await api(
    `logs?source=${encodeURIComponent($("#log-source").value)}`,
  );
  output.textContent = value.text
    ? value.text
        .split(/\r?\n/)
        .map((line) => {
          try {
            const entry = JSON.parse(line);
            const time = entry.timestamp
              ? new Date(entry.timestamp).toLocaleTimeString()
              : "";
            return `${time} ${String(entry.level || "info")
              .toUpperCase()
              .padEnd(
                5,
              )} ${entry.comp ? `[${entry.comp}] ` : ""}${entry.message || ""}${entry.gameID ? ` · ${entry.gameID}` : ""}`;
          } catch {
            return line;
          }
        })
        .join("\n")
    : "No log entries yet.";
  if (atBottom) output.scrollTop = output.scrollHeight;
}
async function refresh() {
  try {
    render(await api("status"));
    await refreshLogs();
  } catch (error) {
    $("#connection").textContent = "Panel disconnected";
    $("#connection").classList.remove("online");
    notify(error.message, true);
  }
}
for (const button of document.querySelectorAll("[data-action]"))
  button.addEventListener("click", async () => {
    actionPending = true;
    if (snapshot) render(snapshot);
    notify(
      `${button.dataset.action === "publish" ? "Publishing the current address to GitHub Pages" : `${button.dataset.action} requested`}…`,
    );
    try {
      await api(button.dataset.action, {});
      notify(
        button.dataset.action === "publish"
          ? "Arcade address pushed. GitHub Pages is deploying the update."
          : "Server action completed.",
      );
    } catch (error) {
      notify(error.message, true);
    } finally {
      actionPending = false;
      await refresh();
    }
  });
form.addEventListener("input", () => {
  dirty = true;
  $("#settings-state").textContent = "Unsaved changes";
});
form.elements.nationMode.addEventListener("change", () => {
  form.elements.nationCount.hidden =
    form.elements.nationMode.value !== "custom";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  actionPending = true;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await api("settings", readSettings());
    dirty = false;
    notify(
      "Configuration saved. New-game defaults apply to new private lobbies.",
    );
    $("#save-detail").textContent = "Saved successfully on this PC.";
  } catch (error) {
    notify(error.message, true);
  } finally {
    actionPending = false;
    button.disabled = false;
    await refresh();
  }
});
$("#copy-endpoint").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(snapshot.metrics.publicUrl);
    notify("Public endpoint copied.");
  } catch {
    notify("Select the endpoint above to copy it.");
  }
});
$("#log-source").addEventListener("change", () => {
  $("#log-output").textContent = "Loading…";
  refreshLogs().catch((error) => notify(error.message, true));
});
await refresh();
setInterval(refresh, 2000);
