import { TileRef } from "@openfront/engine-api/game/GameMap";
import { TrainType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { MotionPlanRecord } from "@openfront/engine-lib/game/MotionPlans";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTiles,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { RailNetwork } from "../game/RailNetwork";
import { getOrientedRailroad, OrientedRailroad } from "../game/Railroad";
import { TrainStation } from "../game/TrainStation";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class TrainExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private train: Unit | null = null; // primary unit
  private cars: Unit[] = []; // stored back to front
  private hasCargo: boolean = false;
  private currentTile: number = 0;
  private spacing = 2;
  private usedTiles: TileRef[] = []; // used for cars behind
  private stations: TrainStation[] = [];
  private currentRailroad: OrientedRailroad | null = null;
  private speed: number = 2;
  // Snapshot-compatible delivery counter. Intermediate rail nodes never pay.
  private _tradeStopsVisited: number = 0;
  private pathTiles: TileRef[] = [];
  private pathIndex: number = 0;

  constructor(
    private railNetwork: RailNetwork,
    private player: Player,
    private source: TrainStation,
    private destination: TrainStation,
    private numCars: number,
  ) {}

  public owner(): Player {
    return this.player;
  }

  public tradeStopsVisited(): number {
    return this._tradeStopsVisited;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stations = this.railNetwork.findStationsPath(
      this.source,
      this.destination,
    );
    if (!stations || stations.length <= 1) {
      this.active = false;
      return;
    }

    this.stations = stations;
    const railroad = getOrientedRailroad(this.stations[0], this.stations[1]);
    if (railroad) {
      this.currentRailroad = railroad;
    } else {
      this.active = false;
      return;
    }

    const spawn = this.player.canBuild(UnitType.Train, this.stations[0].tile());
    if (spawn === false) {
      console.warn(`cannot build train`);
      this.active = false;
      return;
    }
    this.train = this.createTrainUnits(spawn);

    const carUnitIds = this.cars.map((c) => c.id());
    const pathTiles: TileRef[] = [];
    for (let i = 0; i + 1 < this.stations.length; i++) {
      const segment = getOrientedRailroad(
        this.stations[i],
        this.stations[i + 1],
      );
      if (!segment) {
        this.active = false;
        return;
      }
      pathTiles.push(...segment.getTiles());
    }
    const startTile = this.train.tile();
    if (pathTiles.length === 0 || pathTiles[0] !== startTile) {
      pathTiles.unshift(startTile);
      this.pathIndex = 1;
    }
    this.pathTiles = pathTiles;

    const plan: MotionPlanRecord = {
      kind: "train",
      engineUnitId: this.train.id(),
      carUnitIds,
      planId: 1,
      startTick: ticks + 1,
      speed: this.speed,
      spacing: this.spacing,
      path: pathTiles,
    };
    this.mg.recordMotionPlan(plan);
  }

  tick(ticks: number): void {
    if (!this.active) return;
    if (this.train === null) {
      throw new Error("Not initialized");
    }

    if (!this.train.isActive()) {
      this.deleteTrain();
      return;
    }

    if (!this.reconcileCurrentRailroadSplit()) {
      this.deleteTrain();
      return;
    }

    if (!this.activeSourceOrDestination()) {
      this.deleteTrain();
      return;
    }

    const { tile, arrived } = this.getNextTile();
    if (tile !== null) {
      this.updateCarsPositions(tile);
    } else {
      if (arrived) this.targetReached();
      this.deleteTrain();
      if (arrived) {
        this.destination.onTrainStop(this);
        this._tradeStopsVisited++;
      }
    }
  }

  loadCargo() {
    if (this.hasCargo || this.train === null) {
      return;
    }
    this.hasCargo = true;
    // Starts at 1: don't load tail engine
    for (let i = 1; i < this.cars.length; i++) {
      this.cars[i].setLoaded(true);
    }
  }

  private targetReached() {
    if (this.train === null) {
      return;
    }
    this.train.setReachedTarget();
    this.cars.forEach((car: Unit) => {
      car.setReachedTarget();
    });
  }

  private createTrainUnits(tile: TileRef): Unit {
    const train = this.player.buildUnit(UnitType.Train, tile, {
      targetUnit: this.destination.unit,
      trainType: TrainType.Engine,
    });
    // Tail is also an engine, just for cosmetics
    this.cars.push(
      this.player.buildUnit(UnitType.Train, tile, {
        targetUnit: this.destination.unit,
        trainType: TrainType.TailEngine,
      }),
    );
    for (let i = 0; i < this.numCars; i++) {
      this.cars.push(
        this.player.buildUnit(UnitType.Train, tile, {
          trainType: TrainType.Carriage,
          loaded: this.hasCargo,
        }),
      );
    }
    return train;
  }

  private deleteTrain() {
    this.active = false;
    if (this.train?.isActive()) {
      this.train.delete(false);
    }
    for (const car of this.cars) {
      if (car.isActive()) {
        car.delete(false);
      }
    }
  }

  private activeSourceOrDestination(): boolean {
    return (
      this.source.isActive() &&
      this.destination.isActive() &&
      this.stations.length > 1 &&
      this.stations[1].isActive() &&
      this.stations[0].isActive()
    );
  }

  /**
   * Save the tiles the train go through so the cars can reuse them
   * Don't simply save the tiles the engine uses, otherwise the spacing will be dictated by the train speed
   */
  private saveTraversedTiles(from: number, speed: number) {
    if (!this.currentRailroad) {
      return;
    }
    let tileToSave: number = from;
    for (
      let i = 0;
      i < speed && tileToSave < this.currentRailroad.getTiles().length;
      i++
    ) {
      this.saveTile(this.currentRailroad.getTiles()[tileToSave]);
      tileToSave = tileToSave + 1;
    }
  }

  private saveTile(tile: TileRef) {
    this.usedTiles.push(tile);
    if (this.usedTiles.length > this.cars.length * this.spacing + 3) {
      this.usedTiles.shift();
    }
  }

  private updateCarsPositions(newTile: TileRef) {
    if (this.cars.length > 0) {
      for (let i = this.cars.length - 1; i >= 0; --i) {
        const carTileIndex = (i + 1) * this.spacing + 2;
        if (this.usedTiles.length > carTileIndex) {
          this.cars[i].move(this.usedTiles[carTileIndex]);
        }
      }
    }
    if (this.train !== null) {
      this.train.move(newTile);
    }
  }

  private nextStation(): boolean {
    if (this.stations.length > 2) {
      this.pathIndex += this.currentRailroad?.getTiles().length ?? 0;
      this.stations.shift();
      const railRoad =
        getOrientedRailroad(this.stations[0], this.stations[1]) ??
        this.resolveSplitRailroad();
      if (railRoad) {
        this.currentRailroad = railRoad;
        return true;
      }
    }
    return false;
  }

  private resolveSplitRailroad(): OrientedRailroad | null {
    const [station0, station1] = this.stations;
    const path = this.railNetwork.findStationsPath(station0, station1);
    if (!path || path.length <= 2) return null;
    let cursor = this.pathIndex;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = getOrientedRailroad(path[i], path[i + 1]);
      if (!segment) return null;
      for (const tile of segment.getTiles()) {
        if (this.pathTiles[cursor++] !== tile) {
          return null;
        }
      }
    }
    this.stations.splice(0, 2, ...path);
    return getOrientedRailroad(this.stations[0], this.stations[1]);
  }

  /**
   * Reconcile a split of the railroad currently occupied by the train. The
   * client keeps following the original motion plan, so only replacement
   * segments whose concatenated tiles exactly match that plan are accepted.
   */
  private reconcileCurrentRailroadSplit(): boolean {
    if (this.currentRailroad === null || this.stations.length < 2) return false;

    const [station0, station1] = this.stations;
    if (
      station0.getRailroadTo(station1) ===
      this.currentRailroad.getState().railroad
    )
      return true;
    const direct = getOrientedRailroad(station0, station1);
    if (direct) {
      const oldTiles = this.currentRailroad.getTiles();
      const tiles = direct.getTiles();
      if (
        tiles.length !== oldTiles.length ||
        tiles.some((tile, i) => tile !== oldTiles[i])
      )
        return false;
      this.currentRailroad = direct;
      return true;
    }

    const path = this.railNetwork.findStationsPath(station0, station1);
    if (!path || path.length <= 2) return false;

    const segments: OrientedRailroad[] = [];
    let cursor = this.pathIndex;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = getOrientedRailroad(path[i], path[i + 1]);
      if (!segment) return false;
      segments.push(segment);
      for (const tile of segment.getTiles()) {
        if (this.pathTiles[cursor++] !== tile) return false;
      }
    }

    const oldTiles = this.currentRailroad.getTiles();
    if (cursor !== this.pathIndex + oldTiles.length) return false;

    // Drop replacement stations whose stop boundary is already behind the
    // engine. A station exactly at the engine remains as a route boundary;
    // only the trip's final destination is eligible for a payout.
    let activeSegment = 0;
    let segmentStart = 0;
    let boundary = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      boundary += segments[i].getTiles().length;
      const stopIndex = this.stopIndexAtBoundary(
        path[i + 1],
        oldTiles,
        boundary,
      );
      if (this.currentTile <= stopIndex) break;
      activeSegment = i + 1;
      segmentStart = boundary;
    }

    this.pathIndex += segmentStart;
    this.currentTile -= segmentStart;
    this.currentRailroad = segments[activeSegment];
    this.stations.splice(0, 2, ...path.slice(activeSegment));
    return true;
  }

  /**
   * Railroad segments can meet on either side of the station building tile.
   * Pick the adjacent rail tile closest to the station to determine the exact
   * engine position at which that stop is reached.
   */
  private stopIndexAtBoundary(
    station: TrainStation,
    tiles: readonly TileRef[],
    boundary: number,
  ): number {
    if (this.mg === null) throw new Error("Not initialized");

    const before = boundary - 1;
    const after = boundary;
    const stationX = this.mg.x(station.tile());
    const stationY = this.mg.y(station.tile());
    const distanceSquared = (index: number) => {
      const dx = this.mg!.x(tiles[index]) - stationX;
      const dy = this.mg!.y(tiles[index]) - stationY;
      return dx * dx + dy * dy;
    };

    return distanceSquared(before) <= distanceSquared(after) ? before : after;
  }

  private canTradeWithDestination() {
    return (
      this.stations.length > 1 && this.stations[1].tradeAvailable(this.player)
    );
  }

  private getNextTile(): { tile: TileRef | null; arrived: boolean } {
    if (this.currentRailroad === null || !this.canTradeWithDestination()) {
      return { tile: null, arrived: false };
    }
    this.saveTraversedTiles(this.currentTile, this.speed);
    this.currentTile = this.currentTile + this.speed;
    while (this.currentTile >= this.currentRailroad.getTiles().length) {
      const leftOver =
        this.currentTile - this.currentRailroad.getTiles().length;
      if (this.stations[1] === this.destination)
        return { tile: null, arrived: true };
      // Other stations are rail junctions, not economic stops.
      if (!this.nextStation()) {
        return { tile: null, arrived: false };
      }
      if (!this.canTradeWithDestination())
        return { tile: null, arrived: false };
      this.currentTile = leftOver;
      this.saveTraversedTiles(0, leftOver);
    }
    return {
      tile: this.currentRailroad.getTiles()[this.currentTile] ?? null,
      arrived: false,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    if (this.railNetwork !== w.game.railNetwork()) {
      throw new Error("TrainExecution: only the game's rail network is stored");
    }
    const rr = this.currentRailroad?.getState() ?? null;
    return TrainExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== null,
      train: w.unitOrNull(this.train),
      cars: this.cars.map((c) => w.unit(c)),
      hasCargo: this.hasCargo,
      currentTile: this.currentTile,
      spacing: this.spacing,
      usedTiles: w.tiles(this.usedTiles),
      stations: this.stations.map((st) => w.station(st)),
      currentRailroad:
        rr === null
          ? null
          : { railroad: w.railroad(rr.railroad), forward: rr.forward },
      speed: this.speed,
      tradeStopsVisited: this._tradeStopsVisited,
      pathTiles: w.tiles(this.pathTiles),
      pathIndex: this.pathIndex,
      player: w.player(this.player),
      source: w.station(this.source),
      destination: w.station(this.destination),
      numCars: this.numCars,
    });
  }

  restoreSnapshot(s: TrainExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    this.mg = s.initialized ? r.game : null;
    this.train = r.unitOrNull(s.train);
    this.cars = s.cars.map((i) => r.unit(i));
    this.hasCargo = s.hasCargo;
    this.currentTile = s.currentTile;
    this.spacing = s.spacing;
    this.usedTiles = Array.from(s.usedTiles);
    this.stations = s.stations.map((i) => r.station(i));
    // Railroads are filled before executions, so the constructor can read
    // the railroad's tiles (a forward one shares its array, as when live).
    this.currentRailroad =
      s.currentRailroad === null
        ? null
        : new OrientedRailroad(
            r.railroad(s.currentRailroad.railroad),
            s.currentRailroad.forward,
          );
    this.speed = s.speed;
    this._tradeStopsVisited = s.tradeStopsVisited;
    this.pathTiles = Array.from(s.pathTiles);
    this.pathIndex = s.pathIndex;
    this.railNetwork = r.game.railNetwork();
    this.player = r.player(s.player);
    this.source = r.station(s.source);
    this.destination = r.station(s.destination);
    this.numCars = s.numCars;
  }
}

const TrainExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  train: zRef().nullable(),
  /** Back to front. */
  cars: z.array(zRef()),
  hasCargo: z.boolean(),
  currentTile: zInt(),
  spacing: zInt(),
  usedTiles: zTiles(),
  stations: z.array(zRef()),
  currentRailroad: z
    .object({ railroad: zRef(), forward: z.boolean() })
    .nullable(),
  speed: zInt(),
  tradeStopsVisited: zInt(),
  pathTiles: zTiles(),
  pathIndex: zInt(),
  player: zPlayerRef(),
  source: zRef(),
  destination: zRef(),
  numCars: zInt(),
});
type TrainExecutionState = z.infer<typeof TrainExecutionStateSchema>;

export const TrainExecutionSnapshot = execSnapshotType({
  name: "Train",
  version: 1,
  schema: TrainExecutionStateSchema,
  cls: () => TrainExecution,
});
