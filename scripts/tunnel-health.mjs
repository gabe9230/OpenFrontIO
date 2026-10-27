import { Resolver } from "node:dns/promises";
import https from "node:https";

export async function publicServerOnline(address) {
  try {
    const response = await fetch(`${address}/selfhost/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok && (await response.json()).online) return true;
  } catch {}
  const url = new URL(`${address}/selfhost/health`);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".trycloudflare.com"))
    return false;
  // Fresh tunnel names can exist in Cloudflare DNS before the PC's configured
  // resolver knows them. Resolve this probe directly, without changing system
  // DNS. HTTPS still verifies the original hostname and its certificate.
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(["1.1.1.1", "1.0.0.1"]);
  const addresses = await resolver.resolve4(url.hostname);
  if (!addresses.length) return false;
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all)
            callback(
              null,
              addresses.map((address) => ({ address, family: 4 })),
            );
          else callback(null, addresses[0], 4);
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096)
            request.destroy(new Error("Unexpected health response."));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve(
              response.statusCode === 200 && JSON.parse(body).online === true,
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.setTimeout(3000, () =>
      request.destroy(new Error("Tunnel probe timed out.")),
    );
    request.on("error", reject);
  });
}
