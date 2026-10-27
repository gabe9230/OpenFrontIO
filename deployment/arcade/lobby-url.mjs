export function lobbyPath(search) {
  const params = new URLSearchParams(search);
  const id = params.get("lobby");
  if (!id) return "/";
  if (!/^[A-Za-z0-9]{8,10}$/.test(id))
    throw new Error(
      "This lobby link is invalid. Open the arcade game without the lobby parameter to create a new one.",
    );
  const query = new URLSearchParams();
  if (params.has("live")) query.set("live", "");
  else query.set("lobby", "");
  if (params.has("s")) query.set("s", params.get("s"));
  return `/game/${id}?${query}`;
}

export function inviteFromPath(base, rawPath) {
  const path = new URL(rawPath, "https://game.invalid");
  if (path.origin !== "https://game.invalid") return null;
  const match = path.pathname.match(
    /^\/(?:w\d+\/)?game\/([A-Za-z0-9]{8,10})\/?$/,
  );
  if (!match) return null;
  const invite = new URL(base);
  invite.search = "";
  invite.hash = "";
  invite.searchParams.set("lobby", match[1]);
  for (const key of ["s", "live"])
    if (path.searchParams.has(key))
      invite.searchParams.set(key, path.searchParams.get(key));
  return invite.href;
}
