import { GameType } from "@openfront/engine-api/game/GameTypes";
import EventEmitter from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import { MasterLobbyService } from "../../src/server/MasterLobbyService";
import { startPolling } from "../../src/server/PollingLoop";
import { ServerEnv } from "../../src/server/ServerEnv";
import { mockLogger, cid } from "../util/GameServerHarness";

vi.mock("../../src/server/PollingLoop", () => ({ startPolling: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test("private-only workers reject public creation while accepting invitation lobbies", () => {
  vi.useFakeTimers();
  const manager = new GameManager(mockLogger(), undefined, true);
  expect(
    manager.createGame(cid("public"), { gameType: GameType.Public }),
  ).toBeNull();
  expect(
    manager.createGame(cid("queued"), undefined, undefined, undefined, "ffa"),
  ).toBeNull();
  expect(
    manager.createGame(cid("private"), undefined, "creator"),
  ).not.toBeNull();
  expect(manager.publicLobbies()).toHaveLength(0);
});

test("private-only master becomes healthy without starting a public scheduler", () => {
  vi.spyOn(ServerEnv, "numWorkers").mockReturnValue(1);
  const playlist = { gameConfig: vi.fn() };
  const master = new MasterLobbyService(
    playlist as never,
    mockLogger(),
    false,
    true,
  );
  const worker = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
  };
  worker.send = vi.fn();
  master.registerWorker(0, worker as never);
  worker.emit("message", { type: "workerReady", workerId: 0 });
  expect(master.isHealthy()).toBe(true);
  expect(
    vi
      .mocked(startPolling)
      .mock.calls.some(([, interval]) => interval === 1000),
  ).toBe(false);
  expect(playlist.gameConfig).not.toHaveBeenCalled();
});
