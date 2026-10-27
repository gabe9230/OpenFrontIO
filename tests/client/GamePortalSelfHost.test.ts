import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => true, getInviteGameId: vi.fn() },
}));
vi.mock("../../src/client/PokiSDK", () => ({
  pokiSDK: { isOnPoki: () => false },
}));
import { gamePortal } from "../../src/client/GamePortal";

afterEach(() => {
  delete window.openfrontSelfHosted;
});

test("independent arcade frames use URL lobbies instead of waiting for a portal SDK", async () => {
  window.openfrontSelfHosted = true;
  expect(gamePortal.name()).toBeNull();
  expect(gamePortal.isOnGamePortal()).toBe(false);
  expect(await gamePortal.getInviteGameId()).toBeNull();
  expect(await gamePortal.isInstantMultiplayer()).toBe(false);
});

test("ordinary portal detection remains available outside the PC-hosted game", () => {
  expect(gamePortal.name()).toBe("crazygames");
  expect(gamePortal.isOnGamePortal()).toBe(true);
});
