import { MAX_OBSERVERS, MAX_PLAYERS, NICKNAME_MAX } from "@/lib/game";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, type Role, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { enforceExpiredKicks } from "@/lib/server/membership";
import { getRoomByCode, touchRoom } from "@/lib/server/room";

interface SeatRow {
  id: string;
  nickname: string;
  role: Role;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, deviceId? }
// In the lobby you sit at the table. During (or right after) a game you watch, and sit down at the next one.
// A nickname that already has a seat in the room (player or spectator) reclaims that seat - same player id,
// same role, new token - when the request comes from the same device or the seat has been disconnected for
// 301 s (DISCONNECT_MS). This also works mid-game: the reclaimed player keeps their score sheet and turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    const room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    // A seat whose pending kick already ran out is removed first, so it cannot be reclaimed.
    const current = await enforceExpiredKicks(room);
    const { data: seats, error: seatsError } = await db()
      .from(T.players)
      .select("id, nickname, role, token_hash, device_hash, last_seen_at")
      .eq("room_id", current.id);
    if (seatsError) throw seatsError;
    const members = (seats ?? []) as SeatRow[];

    const existing = members.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      // A pending kick is dropped (coming back counts as "Ignoră"); ready and role are kept.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(current.id);
      await notifyRoom(current.id, "player_rejoined");
      return { code: current.code, playerId: existing.id, token, role: existing.role };
    }

    const players = members.filter((m) => m.role === "player").length;
    const observers = members.length - players;
    let role: Role = current.status === "lobby" ? "player" : "observer";
    if (role === "player" && players >= MAX_PLAYERS) role = "observer";
    if (role === "observer" && observers >= MAX_OBSERVERS) {
      fail(409, `Camera e plină (${MAX_PLAYERS} jucători și ${MAX_OBSERVERS} spectatori).`);
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(T.players)
      .insert({ room_id: current.id, nickname, token_hash: hashToken(token), role, device_hash: deviceHash })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    await touchRoom(current.id);
    await notifyRoom(current.id, "player_joined");
    return { code: current.code, playerId: data.id, token, role };
  });
}
