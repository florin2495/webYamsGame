import "server-only";
import {
  DEFAULT_SETTINGS,
  type GameState,
  isRoomExpired,
  minutesLabel,
  PLAYING_IDLE_MINUTES,
  ROOM_ABANDONED_MS,
  roundOf,
  ROOM_IDLE_MINUTES,
  type Settings,
  settingsError,
  standings,
  totals,
  turnDeadline,
  turnKey,
  TURN_OPTIONS,
} from "@/lib/game";
import type { PublicGame, PublicPlayer, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, type PlayerRow, ROOM_COLUMNS, type RoomRow, T } from "./db";
import { ApiError, fail } from "./http";
import { enforceExpiredKicks } from "./membership";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every idle room (10 min for lobby/finished, 60 min for a game nobody has open). */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const short = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const long = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const a = await db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", short);
  if (a.error) console.error("cleanup failed", a.error);
  const b = await db().from(T.rooms).delete().eq("status", "playing").lt("last_activity_at", long);
  if (b.error) console.error("cleanup failed", b.error);
}

/**
 * Deletes rooms in ANY status (also "playing") with no activity for ROOM_ABANDONED_MS and no player or
 * spectator seen within it (see isRoomAbandoned). Spectators are yams_players rows (role observer), so one
 * embed covers both. Players cascade on delete. Best effort: a failure is logged, never thrown.
 */
export async function cleanupAbandonedRooms(): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - ROOM_ABANDONED_MS).toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .select("id, last_activity_at, players:yams_players!yams_players_room_id_fkey(last_seen_at)")
    .lt("last_activity_at", cutoff)
    .limit(200);
  if (error) {
    console.error("abandoned cleanup (select) failed", error);
    return;
  }
  type Seen = { last_seen_at: string | null }[] | null;
  const ids = (data ?? [])
    .filter((r) => {
      const seen = ((r.players as Seen) ?? []).map((m) => m.last_seen_at);
      return isRoomAbandoned(r.last_activity_at as string, seen, now);
    })
    .map((r) => r.id as string);
  if (ids.length === 0) return;
  // Re-check the activity cutoff in the delete itself, so a room touched meanwhile survives.
  const { error: delError } = await db().from(T.rooms).delete().in("id", ids).lt("last_activity_at", cutoff);
  if (delError) console.error("abandoned cleanup (delete) failed", delError);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  // Lazy enforcement of expired pending kicks, before the caller's membership is checked.
  const room = await enforceExpiredKicks(await getRoomByCode(code));
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar host-ul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Partida nu a început încă.",
      playing: "Partida este în desfășurare.",
      finished: "Partida s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return sortBySeat((data ?? []) as PlayerRow[]);
}

/** Host-chosen order first (seat), then not-yet-placed members by join time. Stable. */
export function sortBySeat<P extends { seat: number | null }>(players: P[]): P[] {
  return [...players].sort((a, b) => (a.seat ?? 1e9) - (b.seat ?? 1e9));
}

/**
 * Writes the room only if nobody else changed it since we read it (optimistic lock on
 * `version`). Two actions at the same time: one wins, the other gets a 409 and retries.
 */
export async function saveRoom(room: RoomRow, update: Partial<Omit<RoomRow, "id" | "version">>): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .update({ ...update, version: room.version + 1, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new VersionConflict();
}

/** Someone else wrote the room between our read and our write. */
export class VersionConflict extends ApiError {
  constructor() {
    super(409, "Altcineva a acționat între timp. Mai încearcă o dată.");
  }
}

/**
 * Runs `fn` on a freshly read room and retries a few times when another write got in first.
 * Every rule is re-checked on the fresh state, so a retry can never apply a stale action.
 */
export async function withRetry<C, T>(load: () => Promise<C>, fn: (ctx: C) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctx = await load();
    try {
      return await fn(ctx);
    } catch (err) {
      if (err instanceof VersionConflict && attempt < 3) continue;
      throw err;
    }
  }
}

/** Validates settings sent by the host; missing fields keep `current`. */
export function parseSettings(body: Record<string, unknown>, current: Settings = DEFAULT_SETTINGS): Settings {
  const s: Settings = {
    turnSeconds: body.turnSeconds === undefined ? current.turnSeconds : Number(body.turnSeconds),
  };
  const problem = settingsError(s);
  if (problem) fail(400, problem);
  return s;
}

/** Settings stored before a field existed get the default for it. */
export function withDefaults(s: Partial<Settings> | null): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  if (!TURN_OPTIONS.includes(merged.turnSeconds)) merged.turnSeconds = DEFAULT_SETTINGS.turnSeconds;
  return merged;
}

const toPublic = (p: PlayerRow, now: number): PublicPlayer => ({
  id: p.id,
  nickname: p.nickname,
  isHost: p.is_host,
  role: p.role,
  ready: p.ready,
  kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
  connected: isConnected(p.last_seen_at, now),
  queued: p.queued_at !== null,
});

/** Everything in Yams is public: dice and sheets are seen by all. Adds derived values for the UI. */
function publicGame(g: GameState, meId: string): PublicGame {
  const seat = g.seats.indexOf(meId);
  return {
    seats: g.seats.map((playerId, i) => ({
      playerId,
      name: g.names[i],
      sheet: g.sheets[i],
      totals: totals(g.sheets[i], g.yamsBonuses[i]),
      yamsBonuses: g.yamsBonuses[i],
      left: g.left[i],
      timeouts: g.timeouts?.[i] ?? 0,
    })),
    mySeat: seat >= 0 ? seat : null,
    turn: g.turn,
    round: roundOf(g),
    dice: g.dice,
    held: g.held,
    rolls: g.rolls,
    turnKey: turnKey(g),
    turnDeadline: turnDeadline(g),
    turnSeconds: g.turnSeconds,
    phase: g.phase,
    last: g.last,
    standings: standings(g),
  };
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const players = await listPlayers(room.id);
  let ordered = players;
  if (room.game) {
    const pos = new Map(room.game.seats.map((id, i) => [id, i]));
    ordered = [...players].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  const now = Date.now();
  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      settings: withDefaults(room.settings),
    },
    players: ordered.map((p) => toPublic(p, now)),
    me: toPublic(me, now),
    game: room.game ? publicGame(room.game, me.id) : null,
    serverNow: now,
  };
}
