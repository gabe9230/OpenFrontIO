import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const website =
  process.env.ARCADE_SITE_REPO || "F:/GithubRepo/gabe9230.github.io";
const endpoint = JSON.parse(
  await readFile(path.join(root, ".selfhost/endpoint.json"), "utf8"),
);
const health = await fetch(`${endpoint.serverUrl}/selfhost/health`, {
  signal: AbortSignal.timeout(15000),
});
if (!health.ok || !(await health.json()).online)
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
