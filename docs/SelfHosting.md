# Host the arcade game on your PC

The website's `Arcade/openfront/` page embeds this complete OpenFront build. The
browser talks to your PC over HTTPS and WebSockets. GitHub Pages stores only the
launcher and its current server address. No router port forwarding is needed.

## Start

Requirements: Node 24.15+ (24.x) and npm 12.1+ (12.x).

```powershell
cd "F:\GithubRepo\Openfront clone"
npm run host:share
```

Keep the terminal open and the PC awake. Open `http://localhost:9080` to play
locally. The command also prints a public `https://….trycloudflare.com` address.
Stop it with Ctrl+C; this stops the game, workers, and tunnel together.
You can also double-click `Start-OpenFront.cmd`. To stop a launcher running in
the background, use `npm run host:stop` from another terminal.

After a restart, publish the new tunnel address from a second terminal:

```powershell
npm run host:publish
```

This updates and commits only `Arcade/openfront/server.json` in
`F:/GithubRepo/gabe9230.github.io` and pushes it to GitHub. Unrelated website edits
are excluded. The initial arcade files must already be installed and committed.
GitHub Pages normally needs a little time to deploy. Set `ARCADE_SITE_REPO` to
use another website checkout. GitHub authentication is required for the push.

## Play with friends

Open `https://gabrielhalloran.org/Arcade/openfront/`, choose Create Lobby in
OpenFront, and configure the match. Click **Copy lobby link** in the arcade bar.
Friends open that URL in their own browsers, join the lobby, and wait for the
host to start. URLs look like:

```text
https://gabrielhalloran.org/Arcade/openfront/?lobby=a123456789&s=abcde
```

The query string works on GitHub Pages without custom rewrite rules. Refreshing
or directly opening it loads the correct lobby. The game itself may also copy a
direct tunnel invite; that link works while the tunnel address is current.
Use the arcade bar's button for links on your website.

## First install / update

Use the upstream lockfile and skip dependency lifecycle scripts:

```powershell
npx --yes --package npm@12.1.0 -- npm run inst
npm run build-prod
npm run test:selfhost
```

Download the official Cloudflare tunnel client into `.selfhost/cloudflared.exe`:

```powershell
New-Item -ItemType Directory .selfhost -Force | Out-Null
Invoke-WebRequest https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -OutFile .selfhost/cloudflared.exe
Get-AuthenticodeSignature .selfhost/cloudflared.exe
```

An existing client can be selected using `CLOUDFLARED_PATH`. `npm run host` starts
only the local game, without a public tunnel. `SELFHOST_PORT` changes the front
port (9080 by default); upstream ports 3000–3002 must be free.

## Scope and persistence

- This is a guest-only independent server. Official OpenFront accounts,
  purchases, ranked matchmaking, and cloud history are not hosted here.
- It uses upstream's guest/development authentication mode behind a gateway
  serving the **built** client, not the Vite development server. Random backend
  keys are generated on each run; admin API paths are blocked at the gateway.
- The public tunnel forwards only the game gateway. Don't forward the internal
  worker ports on your router. Anyone with the arcade link can reach the game.
- Active lobbies live in memory. Stopping the server loses them; old lobby IDs
  do not recreate the match. Browser settings remain in each player's browser.
- Cloudflare Quick Tunnels have temporary addresses, no uptime guarantee, and
  a 200 in-flight-request limit. They are suitable for testing a small game
  with friends. A permanent hostname requires a named tunnel or another HTTPS
  endpoint, configured separately; this setup doesn't change your domain DNS.

Logs and the current endpoint live in `.selfhost/`, which is ignored by Git.
The source for the arcade page is in `deployment/arcade/`. Keep the upstream
OpenFront copyright and licensing notices with the game.
