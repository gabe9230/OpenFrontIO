import { readFile } from "node:fs/promises";
const control = JSON.parse(
  await readFile(new URL("../.selfhost/control.json", import.meta.url), "utf8"),
);
try {
  const response = await fetch(
    `http://127.0.0.1:${control.port}/selfhost/stop`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${control.token}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new Error("The running launcher doesn't match the control file.");
  console.log("Stopped OpenFront and its tunnel.");
} catch (error) {
  if (error.cause?.code === "ECONNREFUSED")
    console.log("OpenFront is already stopped.");
  else throw error;
}
