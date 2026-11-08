import type { LastMove, Settings, Sheet, Standing, Totals } from "./game";

export type RoomStatus = "lobby" | "playing" | "finished";
export type Role = "player" | "observer";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  /** "observer" = joined during a game; sits down at the next one. */
  role: Role;
  ready: boolean;
  /** Ms left of a pending kick (host kicked this player during a game), null when none. */
  kickRemainingMs: number | null;
  /** Seen in the last 45 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  /** Spectator who asked to sit down at the next round. */
  queued: boolean;
}

export interface PublicSeat {
  playerId: string;
  name: string;
  sheet: Sheet;
  totals: Totals;
  yamsBonuses: number;
  left: boolean;
  /** Consecutive turns played by the timer. */
  timeouts: number;
}

/** What a member sees of the running game (everything is public in Yams). */
export interface PublicGame {
  seats: PublicSeat[];
  /** My seat, or null for spectators. */
  mySeat: number | null;
  turn: number;
  /** 1..13: box number the player on turn is playing. */
  round: number;
  /** 0 = not rolled yet this turn. */
  dice: number[];
  held: boolean[];
  rolls: number;
  /** Identifies the current turn, sent back with a timeout. */
  turnKey: string;
  /** ms epoch (server clock) when the turn times out, null once the game is over. */
  turnDeadline: number | null;
  turnSeconds: number;
  phase: "playing" | "over";
  last: LastMove | null;
  standings: Standing[];
}

/** What GET /api/rooms/[code]/state returns to a member. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    settings: Settings;
  };
  /** Seat order while a game exists (spectators last), join order in the lobby. */
  players: PublicPlayer[];
  me: PublicPlayer;
  game: PublicGame | null;
  /** Server clock, to correct timers on devices with a wrong clock. */
  serverNow: number;
  /** Client only: serverNow minus the device clock when this state arrived. */
  clockOffset?: number;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  status: RoomStatus;
  hasPassword: boolean;
  players: number;
  observers: number;
  settings: Settings;
}

export interface Session {
  playerId: string;
  token: string;
}
