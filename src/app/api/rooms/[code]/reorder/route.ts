import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, lobby only (no game running).
// `order` must be a full permutation of the players at the table; it becomes the turn order of the next game.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const order = body.order;
    if (!Array.isArray(order) || order.some((id) => typeof id !== "string")) fail(400, "Ordine invalidă.");

    const seated = (await listPlayers(room.id)).filter((p) => p.role === "player").map((p) => p.id);
    const unique = new Set(order as string[]);
    if (unique.size !== order.length || order.length !== seated.length || seated.some((id) => !unique.has(id))) {
      fail(409, "Lista de jucători s-a schimbat între timp. Mai încearcă o dată.");
    }
    for (let i = 0; i < order.length; i++) {
      const { error } = await db().from(T.players).update({ seat: i }).eq("id", order[i]).eq("room_id", room.id);
      if (error) throw error;
    }
    await touchRoom(room.id);
    await notifyRoom(room.id, "order_changed");
    return { ok: true };
  });
}
