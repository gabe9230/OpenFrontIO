import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

export const defaultSettings = {
  port: 9080,
  workers: 2,
  share: true,
  maxConnections: 128,
  allowNewLobbies: true,
  defaults: {
    bots: 400,
    nations: "default",
    difficulty: "Easy",
    goldMultiplier: 1,
    startingGold: 0,
  },
};

export function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Settings must be an object.");
  const value = {
    ...defaultSettings,
    ...input,
    defaults: { ...defaultSettings.defaults, ...input.defaults },
  };
  const number = (v, min, max, name, integer = true) => {
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      throw new Error(
        `${name} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`,
      );
    return v;
  };
  number(value.port, 1024, 65535, "Game port");
  if (
    [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 9090].includes(
      value.port,
    )
  )
    throw new Error(
      "Game port conflicts with an internal worker or the control panel.",
    );
  number(value.workers, 1, 8, "Workers");
  number(value.maxConnections, 2, 1000, "Connection limit");
  if (
    typeof value.share !== "boolean" ||
    typeof value.allowNewLobbies !== "boolean"
  )
    throw new Error("Server switches must be true or false.");
  const d = value.defaults;
  number(d.bots, 0, 400, "Tribes");
  if (!["default", "disabled"].includes(d.nations))
    number(d.nations, 1, 400, "Nations");
  if (!["Easy", "Medium", "Hard", "Impossible"].includes(d.difficulty))
    throw new Error("Choose a valid difficulty.");
  number(d.goldMultiplier, 0.1, 1000, "Gold multiplier", false);
  number(d.startingGold, 0, 1000000000, "Starting gold");
  // Select explicitly: persisted settings can never inject environment variables,
  // executable names, arbitrary commands, or additional game configuration.
  return {
    port: value.port,
    workers: value.workers,
    share: value.share,
    maxConnections: value.maxConnections,
    allowNewLobbies: value.allowNewLobbies,
    defaults: {
      bots: d.bots,
      nations: d.nations,
      difficulty: d.difficulty,
      goldMultiplier: d.goldMultiplier,
      startingGold: d.startingGold,
    },
  };
}

export async function loadSettings(file) {
  try {
    return validateSettings(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(defaultSettings);
    throw error;
  }
}
export async function saveSettings(file, value) {
  const validated = validateSettings(value);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(validated, null, 2) + "\n");
  await rename(temporary, file);
  return validated;
}
