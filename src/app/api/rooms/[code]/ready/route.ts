import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/ready  { ready: boolean } - a player at the table says they are ready (or not yet).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/ready">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "lobby");
    if (player.role !== "player") fail(409, "Ești spectator: joci de la următoarea partidă.");
    const body = await readJson(req);
    if (typeof body.ready !== "boolean") fail(400, "Valoare invalidă.");
    if (body.ready === player.ready) return { ok: true };

    const { error } = await db().from(T.players).update({ ready: body.ready }).eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "player_ready");
    return { ok: true };
  });
}
