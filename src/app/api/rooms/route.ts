import { connection } from "next/server";
import { NICKNAME_MAX } from "@/lib/game";
import { hashDeviceId, hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupExpiredRooms, parseSettings, withDefaults } from "@/lib/server/room";
import type { RoomListItem } from "@/lib/types";

// GET /api/rooms - public list of every room: lobbies (join to play), running and just-finished games (join to watch, play the next one). Idle rooms are deleted by cleanupExpiredRooms.
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await cleanupExpiredRooms();
    const { data, error } = await db()
      .from(T.rooms)
      .select("code, name, status, settings, password_hash, players:yams_players!yams_players_room_id_fkey(role)")
      .in("status", ["lobby", "playing", "finished"])
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? []).map((r) => {
      const members = (r.players ?? []) as { role: string }[];
      return {
        code: r.code,
        name: r.name,
        status: r.status,
        hasPassword: r.password_hash !== null,
        players: members.filter((m) => m.role === "player").length,
        observers: members.filter((m) => m.role === "observer").length,
        settings: withDefaults(r.settings),
      };
    });
    return { rooms };
  });
}

// POST /api/rooms - create a room (with its settings) and its host.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const settings = parseSettings(body);

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from(T.rooms)
        .insert({ code: newRoomCode(), name, password_hash: passwordHash, settings })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: hashDeviceId(body.deviceId), is_host: true, role: "player" })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db().from(T.rooms).update({ host_player_id: player.id }).eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
