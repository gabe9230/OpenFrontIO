import { DiplomacyState } from "@openfront/engine-api/game/Diplomacy";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AllianceRequestExecution } from "./AllianceRequestExecution";

/** One-shot intent execution: all persistent proposals live in AllianceRequest. */
export class DiplomacyExecution implements Execution {
  constructor(
    private player: Player,
    private recipientID: string,
    private direction: "raise" | "lower",
  ) {}

  init(game: Game): void {
    if (!game.hasPlayer(this.recipientID)) return;
    const other = game.player(this.recipientID);
    if (
      other === this.player ||
      this.player.isOnSameTeam(other) ||
      !this.player.isAlive() ||
      !other.isAlive()
    )
      return;
    const state = this.player.diplomacyState(other);
    if (this.direction === "lower") {
      if (state > DiplomacyState.War)
        game.setDiplomacyState(this.player, other, state - 1);
      else
        for (const request of [
          ...this.player.incomingAllianceRequests(),
          ...this.player.outgoingAllianceRequests(),
        ]) {
          if (request.requestor() === other || request.recipient() === other)
            request.reject();
        }
      return;
    }
    if (!this.player.canSendAllianceRequest(other)) return;
    game.addExecution(
      new AllianceRequestExecution(this.player, other.id(), true),
    );
  }
  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter) {
    return DiplomacyExecutionSnapshot.write({
      player: w.player(this.player),
      recipientID: this.recipientID,
      direction: this.direction,
    });
  }
  restoreSnapshot(
    s: z.infer<typeof DiplomacyStateSchema>,
    r: SnapshotReader,
  ): void {
    this.player = r.player(s.player);
    this.recipientID = s.recipientID;
    this.direction = s.direction;
  }
}

const DiplomacyStateSchema = z.object({
  player: zPlayerRef(),
  recipientID: z.string(),
  direction: z.enum(["raise", "lower"]),
});
export const DiplomacyExecutionSnapshot = execSnapshotType({
  name: "Diplomacy",
  version: 1,
  schema: DiplomacyStateSchema,
  cls: () => DiplomacyExecution,
});
