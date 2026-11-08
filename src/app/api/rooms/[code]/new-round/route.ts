import { MAX_PLAYERS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { clearKicks } from "@/lib/server/membership";
import { listPlayers, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host only, after a game: back to the lobby for a new one.
// Spectators who pressed "Intră la runda următoare" sit down in queue order (while there are seats); everyone presses "Ready" again.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await saveRoom(room, { status: "lobby", game: null, round: room.round + 1 });
    await clearKicks(room.id);

    const members = await listPlayers(room.id);
    const seated = members.filter((m) => m.role === "player");
    const free = Math.max(0, MAX_PLAYERS - seated.length);
    const queue = members
      .filter((m) => m.role === "observer" && m.queued_at !== null)
      .sort((a, b) => Date.parse(a.queued_at!) - Date.parse(b.queued_at!));
    const promote = queue.slice(0, free);
    // Seat numbers: current table order, then the promoted in queue order.
    const order = [...seated, ...promote].map((m) => m.id);
    const promoted = new Set(promote.map((m) => m.id));
    for (let i = 0; i < order.length; i++) {
      const { error } = await db()
        .from(T.players)
        .update(promoted.has(order[i]) ? { role: "player", seat: i } : { seat: i })
        .eq("id", order[i]);
      if (error) throw error;
    }
    // Everyone who is still a spectator keeps watching; they can ask again for the round after.
    const { error: qError } = await db().from(T.players).update({ queued_at: null }).eq("room_id", room.id);
    if (qError) throw qError;
    const { error } = await db().from(T.players).update({ ready: false }).eq("room_id", room.id);
    if (error) throw error;

    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
