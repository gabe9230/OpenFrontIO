import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicServerOnline } from "./tunnel-health.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const website =
  process.env.ARCADE_SITE_REPO || "F:/GithubRepo/gabe9230.github.io";
const endpoint = JSON.parse(
  await readFile(path.join(root, ".selfhost/endpoint.json"), "utf8"),
);
let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    if (await publicServerOnline(endpoint.serverUrl)) {
      ready = true;
      break;
    }
  } catch {}
  console.log("Waiting for the new public tunnel address to become reachable…");
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (!ready)
  throw new Error(
    "The public tunnel is offline. Run npm run host:share first.",
  );
const git = (args) =>
  execFileSync("git", ["-C", website, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const target = "Arcade/openfront/server.json";
await writeFile(
  path.join(website, target),
  JSON.stringify(endpoint, null, 2) + "\n",
);
if (!git(["status", "--porcelain", "--", target])) {
  console.log("Arcade already uses this address.");
} else {
  // Commit only our generated address, preserving every unrelated staged edit.
  git(["add", "--", target]);
  git([
    "commit",
    "--only",
    "-m",
    "Update PC-hosted OpenFront endpoint",
    "--",
    target,
  ]);
}
// Also retries a push that failed after a previous successful local commit.
console.log(git(["push", "origin", "HEAD"]));
console.log("Arcade address published. GitHub Pages will deploy it shortly.");
