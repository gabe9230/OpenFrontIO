import { GameConfigSchema } from "@openfront/engine-api/Schemas";
import { readFile } from "node:fs/promises";

// The PC panel saves only defaults for NEW private lobbies. Existing matches
// keep their deterministic settings; an explicit create-game config wins.
export async function loadSelfHostDefaults() {
  const file = process.env.SELFHOST_SETTINGS_PATH;
  if (!file) return {};
  const settings = JSON.parse(await readFile(file, "utf8"));
  return GameConfigSchema.pick({
    bots: true,
    nations: true,
    difficulty: true,
    goldMultiplier: true,
    startingGold: true,
  })
    .partial()
    .parse(settings.defaults);
}
