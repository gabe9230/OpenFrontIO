import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { Cluster, TrainStation } from "@openfront/engine/game/TrainStation";
import { vi, type Mocked } from "vitest";

vi.mock("@openfront/engine/game/Game");
vi.mock("@openfront/engine-api/game/GameTypes");
vi.mock("@openfront/engine/execution/TrainExecution");
vi.mock("@openfront/engine-lib/PseudoRandom");

describe("TrainStation", () => {
  let game: Mocked<Game>;
  let gameStats: {
    trainExternalTrade: ReturnType<typeof vi.fn>;
    trainSelfTrade: ReturnType<typeof vi.fn>;
  };
  let unit: Mocked<Unit>;
  let player: Mocked<Player>;
  let trainExecution: Mocked<TrainExecution>;

  beforeEach(() => {
    gameStats = {
      trainExternalTrade: vi.fn(),
      trainSelfTrade: vi.fn(),
    };
    game = {
      ticks: vi.fn().mockReturnValue(123),
      config: vi.fn().mockReturnValue({
        trainGold: (rel: string, _destinationLevel: number) =>
          rel !== "other" ? BigInt(1000) : BigInt(500),
      }),
      addUpdate: vi.fn(),
      addExecution: vi.fn(),
      stats: vi.fn().mockReturnValue(gameStats),
    } as any;

    player = {
      addGold: vi.fn(),
      addTrainGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
      isFriendly: vi.fn().mockReturnValue(false),
    } as any;

    unit = {
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn().mockReturnValue(1),
      tile: vi.fn().mockReturnValue({ x: 0, y: 0 }),
      type: vi.fn(),
      isActive: vi.fn().mockReturnValue(true),
    } as any;

    trainExecution = {
      loadCargo: vi.fn(),
      owner: vi.fn().mockReturnValue(player),
      level: vi.fn(),
      tradeStopsVisited: vi.fn().mockReturnValue(0),
    } as any;
  });

  it("handles City stop", () => {
    unit.type.mockReturnValue(UnitType.City);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
  });

  it("handles allied trade", () => {
    unit.type.mockReturnValue(UnitType.City);
    player.isFriendly.mockReturnValue(true);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(unit.owner().addGold).toHaveBeenCalledWith(1000n, unit.tile());
    expect(trainExecution.owner().addGold).toHaveBeenCalledWith(
      1000n,
      unit.tile(),
    );
  });

  it("records external trade on the station owner", () => {
    const stationOwner = {
      addGold: vi.fn(),
      addTrainGold: vi.fn(),
      id: 1,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;
    const trainOwner = {
      addGold: vi.fn(),
      addTrainGold: vi.fn(),
      id: 2,
      canTrade: vi.fn().mockReturnValue(true),
      isAlliedWith: vi.fn().mockReturnValue(false),
      isOnSameTeam: vi.fn().mockReturnValue(false),
    } as any;

    unit.type.mockReturnValue(UnitType.City);
    unit.owner.mockReturnValue(stationOwner);
    trainExecution.owner.mockReturnValue(trainOwner);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(stationOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(trainOwner.addGold).toHaveBeenCalledWith(500n, unit.tile());
    expect(stationOwner.addTrainGold).toHaveBeenCalledWith(500n);
    expect(trainOwner.addTrainGold).toHaveBeenCalledWith(500n);
    expect(gameStats.trainExternalTrade).toHaveBeenCalledWith(
      stationOwner,
      500n,
    );
    expect(gameStats.trainSelfTrade).toHaveBeenCalledWith(trainOwner, 500n);
  });

  it("passes the destination building level to trainGold", () => {
    unit.type.mockReturnValue(UnitType.City);
    const trainGoldSpy = vi.fn().mockReturnValue(500n);
    (game.config as any).mockReturnValue({
      trainGold: trainGoldSpy,
    });
    unit.level.mockReturnValue(5);
    const station = new TrainStation(game, unit);

    station.onTrainStop(trainExecution);

    expect(trainGoldSpy).toHaveBeenCalledWith(
      expect.any(String),
      5,
      expect.anything(),
    );
  });

  it("checks trade availability (same owner)", () => {
    const otherUnit = {
      owner: vi.fn().mockReturnValue(unit.owner()),
    } as any;

    const station = new TrainStation(game, unit);
    const otherStation = new TrainStation(game, otherUnit);

    expect(station.tradeAvailable(otherStation.unit.owner())).toBe(true);
  });

  it("adds and retrieves neighbors", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);
    const railRoad = { from: stationA, to: stationB, tiles: [] } as any;

    stationA.addRailroad(railRoad);

    const neighbors = stationA.neighbors();
    expect(neighbors).toContain(stationB);
  });

  it("removes neighboring rail", () => {
    const stationA = new TrainStation(game, unit);
    const stationB = new TrainStation(game, unit);

    const railRoad = {
      from: stationA,
      to: stationB,
      tiles: [{ x: 1, y: 1 }],
    } as any;

    stationA.addRailroad(railRoad);
    expect(stationA.getRailroads().size).toBe(1);

    stationA.removeNeighboringRails(stationB);

    expect(game.addUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: GameUpdateType.RailroadDestructionEvent,
      }),
    );
    expect(stationA.getRailroads().size).toBe(0);
  });

  it("assigns and retrieves cluster", () => {
    const cluster: Cluster = {} as Cluster;
    const station = new TrainStation(game, unit);

    station.setCluster(cluster);
    expect(station.getCluster()).toBe(cluster);
  });

  it("returns tile and active status", () => {
    const station = new TrainStation(game, unit);
    expect(station.tile()).toEqual({ x: 0, y: 0 });
    expect(station.isActive()).toBe(true);
  });
});

describe("EngineConfig.trainGold destination level", () => {
  let config: EngineConfig;
  let mockPlayer: Player;

  beforeEach(() => {
    const gameConfig: GameConfig = {
      gameMap: GameMapType.Asia,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      disableNavMesh: false,
      randomSpawn: false,
    };
    config = new EngineConfig(gameConfig, false);
    mockPlayer = { isLobbyCreator: () => false } as unknown as Player;
  });

  it.each([
    ["self", 0, 50_000n],
    ["ally", 0, 150_000n],
    ["other", 0, 100_000n],
    ["self", 1, 55_000n],
    ["ally", 1, 165_000n],
    ["team", 1, 110_000n],
    ["ally", 10, 300_000n],
    ["other", 5, 150_000n],
    ["team", 5, 150_000n],
    ["self", 20, 150_000n],
  ] as const)(
    "%s delivery to level %i pays %s",
    (relation, level, expected) => {
      expect(config.trainGold(relation, level, mockPlayer)).toBe(expected);
    },
  );

  it("applies the game gold multiplier after the destination-level bonus", () => {
    const boosted = new EngineConfig(
      { goldMultiplier: 2 } as GameConfig,
      false,
    );
    expect(boosted.trainGold("ally", 10, mockPlayer)).toBe(600_000n);
  });

  it("rounds a fractional gold multiplier down to whole gold", () => {
    const fractional = new EngineConfig(
      { goldMultiplier: 0.333333 } as GameConfig,
      false,
    );
    expect(fractional.trainGold("self", 1, mockPlayer)).toBe(18_333n);
  });
});
