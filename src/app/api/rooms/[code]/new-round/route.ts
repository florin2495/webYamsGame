import { MAX_PLAYERS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { clearKicks } from "@/lib/server/membership";
import { listPlayers, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host only, after a game: back to the lobby for a new one.
// Spectators who joined during the game sit down (while there are seats); everyone presses "Ready" again.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await saveRoom(room, { status: "lobby", game: null, round: room.round + 1 });
    await clearKicks(room.id);

    const members = await listPlayers(room.id);
    const free = MAX_PLAYERS - members.filter((m) => m.role === "player").length;
    const promote = members.filter((m) => m.role === "observer").slice(0, Math.max(0, free)).map((m) => m.id);
    if (promote.length > 0) {
      const { error } = await db().from(T.players).update({ role: "player" }).in("id", promote);
      if (error) throw error;
    }
    const { error } = await db().from(T.players).update({ ready: false }).eq("room_id", room.id);
    if (error) throw error;

    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
