import { DiplomacyState as D } from "@openfront/engine-api/game/Diplomacy";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { DiplomacyIntentSchema } from "@openfront/engine-api/Schemas";
import { DiplomacyExecution } from "@openfront/engine/execution/alliance/DiplomacyExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { TransportShipExecution } from "@openfront/engine/execution/TransportShipExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";

let game: Game, a: Player, b: Player, c: Player;
const ticks = (n = 2) => {
  for (let i = 0; i < n; i++) game.executeNextTick();
};
const change = (from: Player, to: Player, direction: "raise" | "lower") => {
  game.addExecution(new DiplomacyExecution(from, to.id(), direction));
  ticks();
};

describe("four-tier diplomacy", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true, infiniteGold: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
      new PlayerInfo("b", PlayerType.Human, "b", "b"),
      new PlayerInfo("c", PlayerType.Human, "c", "c"),
    ]);
    [a, b, c] = [game.player("a"), game.player("b"), game.player("c")];
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 80; y++) (x < 5 ? a : b).conquer(game.ref(x, y));
    c.conquer(game.ref(20, 20));
    for (const p of [a, b, c]) p.addTroops(100_000);
  });

  test("defaults to Neutral, with independent armies", () => {
    expect(a.diplomacyState(b)).toBe(D.Neutral);
    const before = b.troops();
    a.removeTroops(1000);
    expect(b.troops()).toBe(before);
    expect(a.canPirate(b)).toBe(false);
  });

  test("raising needs approval and Allied is the highest tier", () => {
    change(a, b, "raise");
    expect(a.diplomacyState(b)).toBe(D.Neutral);
    expect(b.incomingAllianceRequests()[0].requestedState()).toBe(D.Allied);
    change(b, a, "raise");
    expect(a.diplomacyState(b)).toBe(D.Allied);
    expect(b.diplomacyState(a)).toBe(D.Allied);
    expect(a.canSendAllianceRequest(b)).toBe(false);
    change(a, b, "raise");
    expect(a.outgoingAllianceRequests()).toHaveLength(0);
    expect(a.allianceWith(b)?.expiresAt()).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("downgrades immediately update both sides and never go below War", () => {
    change(a, b, "lower");
    expect(b.diplomacyState(a)).toBe(D.ColdWar);
    expect(a.canPirate(b)).toBe(true);
    change(b, a, "lower");
    expect(a.diplomacyState(b)).toBe(D.War);
    change(a, b, "lower");
    expect(a.diplomacyState(b)).toBe(D.War);
    expect(a.diplomacyState(c)).toBe(D.Neutral);
  });

  test("approved raises advance exactly one tier, including after War", () => {
    a.declareWar(b);
    for (const target of [D.ColdWar, D.Neutral, D.Allied]) {
      change(a, b, "raise");
      expect(a.diplomacyState(b)).toBe(target - 1);
      change(b, a, "raise");
      expect(a.diplomacyState(b)).toBe(target);
    }
  });

  test("a rejected or expired proposal does not raise relations", () => {
    change(a, b, "raise");
    b.incomingAllianceRequests()[0].reject();
    expect(a.diplomacyState(b)).toBe(D.Neutral);
    game.config().allianceRequestCooldown = () => 0;
    game.config().allianceRequestDuration = () => 3;
    change(a, b, "raise");
    ticks(6);
    expect(b.incomingAllianceRequests()).toHaveLength(0);
    expect(a.diplomacyState(b)).toBe(D.Neutral);
  });

  test("a downgrade invalidates stale approvals", () => {
    change(a, b, "raise");
    const proposal = b.incomingAllianceRequests()[0];
    change(b, a, "lower");
    proposal.accept();
    expect(proposal.status()).toBe("rejected");
    expect(a.diplomacyState(b)).toBe(D.ColdWar);
  });

  test("a renewed invasion during War invalidates pending peace", () => {
    a.declareWar(b);
    change(a, b, "raise");
    const proposal = b.incomingAllianceRequests()[0];
    game.addExecution(new AttackExecution(1000, a, b.id()));
    ticks();
    proposal.accept();
    expect(proposal.status()).toBe("rejected");
    expect(a.diplomacyState(b)).toBe(D.War);
  });

  test("diplomacy-only changes reach the incremental player update channel", () => {
    a.toUpdate();
    b.toUpdate();
    c.toUpdate();
    game.setDiplomacyState(a, b, D.ColdWar);
    expect(a.toUpdate()?.diplomacy?.[b.smallID()]).toBe(D.ColdWar);
    expect(b.toUpdate()?.diplomacy?.[a.smallID()]).toBe(D.ColdWar);
    expect(c.toUpdate()).toBeNull();
    expect(a.toUpdate()).toBeNull();
    game.setDiplomacyState(a, b, D.War);
    expect(a.toUpdate()?.diplomacy?.[b.smallID()]).toBe(D.War);
  });

  test("accepting a ceasefire withdraws an existing land attack", () => {
    game.addExecution(new AttackExecution(1000, a, b.id()));
    ticks();
    change(a, b, "raise");
    change(b, a, "raise");
    ticks();
    expect(a.diplomacyState(b)).toBe(D.ColdWar);
    expect(a.outgoingAttacks()).toHaveLength(0);
  });

  test("invading Neutral declares War without a betrayal debuff", () => {
    game.addExecution(new AttackExecution(1000, a, b.id()));
    ticks();
    expect(a.diplomacyState(b)).toBe(D.War);
    expect(b.diplomacyState(a)).toBe(D.War);
    expect(a.isTraitor()).toBe(false);
  });

  test("invading an Ally declares War and applies the existing betrayal debuff", () => {
    game.setDiplomacyState(a, b, D.Allied);
    game.addExecution(new AttackExecution(1000, a, b.id()));
    ticks();
    expect(a.diplomacyState(b)).toBe(D.War);
    expect(a.isTraitor()).toBe(true);
  });

  test("allies do not grant cross-border fronts", () => {
    game.setDiplomacyState(a, b, D.Allied);
    b.conquer(game.ref(19, 20));
    expect(a.canAttack(game.ref(20, 20))).toBe(false);
    const before = a.troops();
    game.addExecution(new AttackExecution(1000, a, c.id()));
    ticks();
    expect(a.troops()).toBe(before);
    expect(a.diplomacyState(c)).toBe(D.Neutral);
  });

  test("nuking a Neutral target declares War even below the collateral threshold", () => {
    game.config().nukeAllianceBreakThreshold = () => 100_000;
    a.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        a,
        game.ref(5, 5),
        game.ref(0, 0),
        -1,
        10,
      ),
    );
    ticks();
    expect(a.diplomacyState(b)).toBe(D.War);
    expect(a.isTraitor()).toBe(false);
  });

  test("save/restore retains states, pending proposals, and queued intents", async () => {
    a.declareWar(b);
    change(a, b, "raise");
    game.addExecution(new DiplomacyExecution(a, c.id(), "lower"));
    await expectSnapshotRoundTrip(game, "plains", 8);
  });

  test("intent validation accepts only raise/lower", () => {
    expect(
      DiplomacyIntentSchema.safeParse({
        type: "diplomacy",
        recipient: "bbbbbbbb",
        direction: "raise",
      }).success,
    ).toBe(true);
    expect(
      DiplomacyIntentSchema.safeParse({
        type: "diplomacy",
        recipient: "b",
        direction: "federate",
      }).success,
    ).toBe(false);
  });
});

describe("diplomacy and piracy", () => {
  test.each([D.Neutral, D.Allied])(
    "a successful naval invasion declares War from state %s",
    async (state) => {
      const g = await setup("half_land_half_ocean", { instantBuild: true }, [
        new PlayerInfo("a", PlayerType.Human, null, "a"),
        new PlayerInfo("b", PlayerType.Human, null, "b"),
      ]);
      const attacker = g.player("a"),
        defender = g.player("b");
      attacker.conquer(g.ref(7, 2));
      defender.conquer(g.ref(7, 14));
      attacker.addTroops(10_000);
      defender.addTroops(10_000);
      g.setDiplomacyState(attacker, defender, state);
      g.addExecution(new TransportShipExecution(attacker, g.ref(7, 14), 1000));
      g.executeNextTick();
      g.executeNextTick();
      expect(attacker.units(UnitType.TransportShip)).toHaveLength(1);
      expect(attacker.diplomacyState(defender)).toBe(D.War);
      expect(attacker.isTraitor()).toBe(state === D.Allied);
    },
  );
  test.each([D.Allied, D.Neutral, D.ColdWar, D.War])(
    "piracy policy is enforced by actual warships at state %s",
    async (state) => {
      const g = await setup(
        "half_land_half_ocean",
        { instantBuild: true, infiniteGold: true },
        [
          new PlayerInfo("a", PlayerType.Human, null, "a"),
          new PlayerInfo("b", PlayerType.Human, null, "b"),
        ],
      );
      const pirate = g.player("a"),
        merchant = g.player("b");
      for (let i = 0; i < 50; i++) g.executeNextTick(); // Existing initial safe-passage cooldown.
      pirate.buildUnit(UnitType.Port, g.ref(7, 10), {});
      const ship = pirate.buildUnit(UnitType.Warship, g.ref(8, 10), {
        patrolTile: g.ref(8, 10),
      });
      const port = merchant.buildUnit(UnitType.Port, g.ref(7, 14), {});
      const trade = merchant.buildUnit(UnitType.TradeShip, g.ref(9, 10), {
        targetUnit: port,
      });
      g.setDiplomacyState(pirate, merchant, state);
      const exec = new WarshipExecution(ship);
      g.addExecution(exec);
      for (let i = 0; i < 4; i++) g.executeNextTick();
      expect(trade.owner().id()).toBe(
        (state <= D.ColdWar ? pirate : merchant).id(),
      );
    },
  );
});
