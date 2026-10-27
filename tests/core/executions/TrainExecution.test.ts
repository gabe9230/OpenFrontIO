import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { Railroad } from "@openfront/engine/game/Railroad";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";

async function currentSegmentFixture(
  splitIndex: number,
  reverseDirection = false,
  insertedType = UnitType.City,
  initialize = true,
) {
  const game = await setup("plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  const player = game.player("p1")!;
  const railTiles = [1, 2, 3, 4, 5, 6, 7, 8, 9] as TileRef[];
  railTiles.forEach((tile) => player.conquer(tile));

  const stationA = new TrainStation(
    game,
    player.buildUnit(UnitType.City, railTiles[0], {}),
  );
  const stationB = new TrainStation(
    game,
    player.buildUnit(UnitType.City, railTiles[railTiles.length - 1], {}),
  );
  const insertedStation = new TrainStation(
    game,
    player.buildUnit(insertedType, railTiles[splitIndex], {}),
  );

  const net = game.railNetwork();
  const stationManager = net.stationManager();
  stationManager.addStation(stationA);
  stationManager.addStation(stationB);

  const originalRailroad = new Railroad(stationA, stationB, railTiles, 1);
  stationA.addRailroad(originalRailroad);
  stationB.addRailroad(originalRailroad);

  const source = reverseDirection ? stationB : stationA;
  const destination = reverseDirection ? stationA : stationB;
  const exec = new TrainExecution(net, player, source, destination, 1);
  if (initialize) exec.init(game, 0);
  expect(exec.isActive()).toBe(true);

  const splitRail = () => {
    stationA.removeRailroad(originalRailroad);
    stationB.removeRailroad(originalRailroad);
    stationManager.addStation(insertedStation);

    const first = new Railroad(
      stationA,
      insertedStation,
      railTiles.slice(0, splitIndex),
      2,
    );
    const second = new Railroad(
      insertedStation,
      stationB,
      railTiles.slice(splitIndex),
      3,
    );
    stationA.addRailroad(first);
    insertedStation.addRailroad(first);
    insertedStation.addRailroad(second);
    stationB.addRailroad(second);
  };

  return {
    game,
    exec,
    insertedStation,
    player,
    splitRail,
    source,
    destination,
    originalRailroad,
  };
}

describe("TrainExecution", () => {
  it("does not repay an earlier stop after saving and restoring mid-trip", async () => {
    const { game, exec, player, splitRail } = await currentSegmentFixture(
      4,
      false,
      UnitType.City,
      false,
    );
    splitRail();
    game.addExecution(exec);
    for (let i = 0; i < 10 && exec.tradeStopsVisited() === 0; i++)
      game.executeNextTick();
    expect(exec.tradeStopsVisited()).toBe(1);
    expect(player.trainGold()).toBe(55_000n);
    const restored = await expectSnapshotRoundTrip(game, "plains", 10);
    expect(player.trainGold()).toBe(110_000n);
    expect(restored.player(player.id()).trainGold()).toBe(110_000n);
  });
  it("pays once at each visited city and despawns at the final destination", async () => {
    const { exec, player, source, destination, insertedStation, splitRail } =
      await currentSegmentFixture(4);
    const sourceStop = vi.spyOn(source, "onTrainStop");
    const intermediateStop = vi.spyOn(insertedStation, "onTrainStop");
    const originalStop = destination.onTrainStop.bind(destination);
    const finalStop = vi
      .spyOn(destination, "onTrainStop")
      .mockImplementation((train) => {
        expect(player.units(UnitType.Train)).toHaveLength(0);
        originalStop(train);
      });
    splitRail();
    for (let tick = 1; tick <= 10; tick++) exec.tick(tick);
    expect(exec.isActive()).toBe(false);
    expect(sourceStop).not.toHaveBeenCalled();
    expect(intermediateStop).toHaveBeenCalledTimes(1);
    expect(finalStop).toHaveBeenCalledTimes(1);
    expect(player.trainGold()).toBe(110_000n);
    expect(exec.tradeStopsVisited()).toBe(2);
  });

  it("uses the destination level when the train arrives", async () => {
    const { exec, player, destination } = await currentSegmentFixture(4);
    exec.tick(1);
    for (let level = 1; level < 10; level++) destination.unit.increaseLevel();
    for (let tick = 2; tick <= 10; tick++) exec.tick(tick);
    expect(player.trainGold()).toBe(100_000n);
  });

  it("uses each visited building's own level for its payout", async () => {
    const { exec, player, insertedStation, destination, splitRail } =
      await currentSegmentFixture(4);
    for (let level = 1; level < 5; level++)
      insertedStation.unit.increaseLevel();
    for (let level = 1; level < 10; level++) destination.unit.increaseLevel();
    splitRail();
    exec.tick(1);
    exec.tick(2);
    expect(player.trainGold()).toBe(75_000n);
    expect(exec.isActive()).toBe(true);
    for (let tick = 3; tick <= 10; tick++) exec.tick(tick);
    expect(player.trainGold()).toBe(175_000n);
    expect(exec.tradeStopsVisited()).toBe(2);
  });

  it("retains earlier stop revenue when the final destination is destroyed", async () => {
    const { exec, player, destination, splitRail } =
      await currentSegmentFixture(4);
    splitRail();
    exec.tick(1);
    exec.tick(2);
    expect(player.trainGold()).toBe(55_000n);
    destination.unit.delete(false);
    exec.tick(3);
    expect(exec.isActive()).toBe(false);
    expect(player.trainGold()).toBe(55_000n);
    expect(exec.tradeStopsVisited()).toBe(1);
  });

  it("passes through factories without earning a payout or counting a trade stop", async () => {
    const { exec, player, splitRail } = await currentSegmentFixture(
      4,
      false,
      UnitType.Factory,
    );
    splitRail();
    exec.tick(1);
    exec.tick(2);
    expect(player.trainGold()).toBe(0n);
    expect(exec.tradeStopsVisited()).toBe(0);
    for (let tick = 3; tick <= 10; tick++) exec.tick(tick);
    expect(player.trainGold()).toBe(55_000n);
    expect(exec.tradeStopsVisited()).toBe(1);
  });

  it("despawns without paying if the destination is destroyed", async () => {
    const { exec, player, destination } = await currentSegmentFixture(4);
    exec.tick(1);
    destination.unit.delete(false);
    exec.tick(2);
    expect(exec.isActive()).toBe(false);
    expect(player.units(UnitType.Train)).toHaveLength(0);
    expect(player.trainGold()).toBe(0n);
  });

  it("does not award delivery gold when the active rail connection is removed", async () => {
    const { exec, player, source, destination, originalRailroad } =
      await currentSegmentFixture(4);
    exec.tick(1);
    source.removeRailroad(originalRailroad);
    destination.removeRailroad(originalRailroad);
    exec.tick(2);
    expect(exec.isActive()).toBe(false);
    expect(player.units(UnitType.Train)).toHaveLength(0);
    expect(player.trainGold()).toBe(0n);
  });

  it("pays at a station inserted ahead of the engine", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(4);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    splitRail();
    exec.tick(2);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).toHaveBeenCalledTimes(1);
    expect(player.trainGold()).toBe(55_000n);
  });

  it("does not visit or pay a station inserted behind the engine", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(3);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    exec.tick(2);
    splitRail();
    exec.tick(3);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).not.toHaveBeenCalled();
    expect(player.trainGold()).toBe(0n);
  });

  it("pays exactly once at a station inserted at the engine", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(2);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    splitRail();
    exec.tick(2);
    exec.tick(3);

    expect(onTrainStop).toHaveBeenCalledTimes(1);
    expect(player.trainGold()).toBe(55_000n);
  });

  it("does not revisit a passed station while travelling in reverse", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(3, true);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    exec.tick(2);
    exec.tick(3);
    splitRail();
    exec.tick(4);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).not.toHaveBeenCalled();
    expect(player.trainGold()).toBe(0n);
  });

  it("re-resolves intermediate stations when railroad is split in transit", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD1, stationD2] = [
      0, 1, 4, 2, 3,
    ].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3, 3, 4], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Split edge B->C into B->D1, D1->D2, and D2->C while train is in transit
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD1);
    stationManager.addStation(stationD2);
    link(stationB, stationD1, [1, 2], 3);
    link(stationD1, stationD2, [2, 3], 4);
    link(stationD2, stationC, [3, 4], 5);

    exec.tick(1);
    expect(exec.isActive()).toBe(true);
    exec.tick(2);
    expect(exec.isActive()).toBe(true);
    exec.tick(3);
    expect(exec.isActive()).toBe(true);
    exec.tick(4);
    expect(exec.isActive()).toBe(false);
  });

  it("rejects detour when railroad is rerouted off original motion plan", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD] = [0, 1, 2, 4].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 3, 2], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Replace B->C with a detour through station D (tile 4, not on original path [0, 1, 1, 3, 2])
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 4], 3);
    link(stationD, stationC, [4, 2], 4);

    exec.tick(1);
    // At station B, the train attempts nextStation() but rejects the detour through tile 4
    expect(exec.isActive()).toBe(false);
  });

  it("re-resolves when intermediate station is placed off-track (adjacent building tile)", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4, 10].forEach((t) => player.conquer(t));
    // Station D is at tile 10 (adjacent off-track building tile, not in the railroad tile array)
    const [stationA, stationB, stationC, stationD] = [0, 1, 3, 10].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Split edge B->C into B->D [1, 2] and D->C [2, 3], where stationD.tile() = 10
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 2], 3);
    link(stationD, stationC, [2, 3], 4);

    exec.tick(1);
    expect(exec.isActive()).toBe(true);
    exec.tick(2);
    expect(exec.isActive()).toBe(true);
    exec.tick(3);
    expect(exec.isActive()).toBe(false);
  });

  it("rejects detour when only the final segment detours off motion plan", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 9].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD] = [0, 1, 3, 2].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // B->D uses planned tiles [1, 2], but D->C detours through tile 9 [2, 9, 3]
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 2], 3);
    link(stationD, stationC, [2, 9, 3], 4);

    exec.tick(1);
    // Rejects because final segment D->C uses unrecorded tile 9
    expect(exec.isActive()).toBe(false);
  });
});
