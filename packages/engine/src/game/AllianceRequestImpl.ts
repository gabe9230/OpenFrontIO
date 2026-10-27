import { DiplomacyState } from "@openfront/engine-api/game/Diplomacy";
import { Tick } from "@openfront/engine-api/game/GameTypes";
import {
  AllianceRequestUpdate,
  GameUpdateType,
} from "@openfront/engine-api/game/GameUpdates";
import {
  snapshotType,
  zInt,
  zPlayerRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AllianceRequest, Player } from "./Game";
import { GameImpl } from "./GameImpl";

export class AllianceRequestImpl implements AllianceRequest {
  private status_: "pending" | "accepted" | "rejected" = "pending";

  constructor(
    private requestor_: Player,
    private recipient_: Player,
    private tickCreated: number,
    private game: GameImpl,
    private requestedState_: DiplomacyState = DiplomacyState.Allied,
    private previousState_: DiplomacyState = DiplomacyState.Neutral,
    private permanent_: boolean = false,
  ) {}

  requestedState(): DiplomacyState {
    return this.requestedState_;
  }
  previousState(): DiplomacyState {
    return this.previousState_;
  }
  permanent(): boolean {
    return this.permanent_;
  }

  status(): "pending" | "accepted" | "rejected" {
    return this.status_;
  }

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  createdAt(): Tick {
    return this.tickCreated;
  }

  accept(permanent = false): void {
    if (this.status_ !== "pending") return;
    if (
      this.requestor_.diplomacyState(this.recipient_) !== this.previousState_ ||
      this.requestedState_ !== this.previousState_ + 1 ||
      (!this.requestor_.isAlive() && this.requestor_.hasSpawned()) ||
      (!this.recipient_.isAlive() && this.recipient_.hasSpawned())
    ) {
      this.reject();
      return;
    }
    this.permanent_ ||= permanent;
    this.status_ = "accepted";
    this.game.acceptAllianceRequest(this);
  }
  reject(): void {
    if (this.status_ !== "pending") return;
    this.status_ = "rejected";
    this.game.rejectAllianceRequest(this);
  }

  toUpdate(): AllianceRequestUpdate {
    return {
      type: GameUpdateType.AllianceRequest,
      requestorID: this.requestor_.smallID(),
      recipientID: this.recipient_.smallID(),
      createdAt: this.tickCreated,
      requestedState: this.requestedState_,
    };
  }

  snapshot(w: SnapshotWriter): AllianceRequestState {
    return {
      requestor: w.player(this.requestor_),
      recipient: w.player(this.recipient_),
      createdAt: this.tickCreated,
      status: this.status_,
      requestedState: this.requestedState_,
      previousState: this.previousState_,
      permanent: this.permanent_,
    };
  }

  /** Fills a prototype-only shell; see RestorableExecution.restoreSnapshot. */
  restoreSnapshot(s: AllianceRequestState, r: SnapshotReader): void {
    this.game = r.game;
    this.requestor_ = r.player(s.requestor);
    this.recipient_ = r.player(s.recipient);
    this.tickCreated = s.createdAt;
    this.status_ = s.status;
    this.requestedState_ = s.requestedState;
    this.previousState_ = s.previousState;
    this.permanent_ = s.permanent;
  }
}

export const AllianceRequestSnapshot = snapshotType({
  name: "AllianceRequest",
  version: 2,
  migrations: {
    1: (s) => ({
      ...s,
      requestedState: DiplomacyState.Allied,
      previousState: DiplomacyState.Neutral,
      permanent: false,
    }),
  },
  schema: z.object({
    requestor: zPlayerRef(),
    recipient: zPlayerRef(),
    createdAt: zInt(),
    status: z.enum(["pending", "accepted", "rejected"]),
    requestedState: z.nativeEnum(DiplomacyState),
    previousState: z.nativeEnum(DiplomacyState),
    permanent: z.boolean(),
  }),
});
export type AllianceRequestState = z.infer<
  typeof AllianceRequestSnapshot.schema
>;
