import { MAX_PLAYERS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue  { queued?: boolean } - a spectator asks to sit down at the next round (toggle when
// `queued` is omitted). At "Rundă nouă" the queue is seated in order while there are free seats. In the lobby a free
// seat is taken at once.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.role !== "observer") fail(409, "Ești deja jucător.");
    const body = req.headers.get("content-type")?.includes("json") ? await readJson(req) : {};
    const want = typeof body.queued === "boolean" ? body.queued : player.queued_at === null;

    if (want && room.status === "lobby") {
      const players = await listPlayers(room.id);
      const seated = players.filter((p) => p.role === "player");
      if (seated.length < MAX_PLAYERS) {
        const { error } = await db()
          .from(T.players)
          .update({ role: "player", ready: false, queued_at: null, seat: seated.length })
          .eq("id", player.id);
        if (error) throw error;
        await touchRoom(room.id);
        await notifyRoom(room.id, "player_seated");
        return { queued: false, seated: true };
      }
    }
    if (want === (player.queued_at !== null)) return { queued: want, seated: false };

    const { error } = await db()
      .from(T.players)
      .update({ queued_at: want ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue_changed");
    return { queued: want, seated: false };
  });
}
