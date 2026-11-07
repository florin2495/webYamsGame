import { notifyRoom } from "@/lib/server/broadcast";
import { handle, readJson } from "@/lib/server/http";
import { parseSettings, requireHost, requireMember, requireStatus, saveRoom, withDefaults } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { turnSeconds } - host only, before the game starts.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby", "finished");

    const settings = parseSettings(await readJson(req), withDefaults(room.settings));
    await saveRoom(room, { settings });
    await notifyRoom(room.id, "settings_changed");
    return { ok: true };
  });
}
