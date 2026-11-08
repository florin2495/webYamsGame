import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState, Settings } from "@/lib/game";

/**
 * Table names. The Supabase project is shared by every hailatat.icu mini-game,
 * so every Yams object carries the yams_ prefix.
 */
export const T = {
  rooms: "yams_rooms",
  players: "yams_players",
} as const;

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export type Role = "player" | "observer";

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  status: "lobby" | "playing" | "finished";
  round: number;
  host_player_id: string | null;
  settings: Settings;
  game: GameState | null;
  version: number;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, status, round, host_player_id, settings, game, version, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  role: Role;
  /** Ready for the next game (lobby only; the host starts it). */
  ready: boolean;
  joined_at: string;
  /** Set when the host kicked this player during a game; removed KICK_GRACE_MS later unless ignored. */
  kick_requested_at: string | null;
  /** Presence stamp, touched by requireMember. Needs migration 002_reconnect.sql. */
  last_seen_at: string;
  /** Host-chosen play order (migration 003), null = not placed yet. */
  seat: number | null;
  /** Spectator waiting for the next round (migration 003). */
  queued_at: string | null;
}

/** Never add token_hash / device_hash here: these rows feed the public state. */
export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, role, ready, joined_at, kick_requested_at, last_seen_at, seat, queued_at";
