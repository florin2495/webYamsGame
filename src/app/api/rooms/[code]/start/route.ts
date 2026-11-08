import { MAX_PLAYERS, MIN_PLAYERS, newGame } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { clearKicks } from "@/lib/server/membership";
import { fail, handle } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, saveRoom, withDefaults } from "@/lib/server/room";

// POST /api/rooms/[code]/start - host only, 2-16 players, everyone else ready. Turn order: the order saved in the lobby (host can reorder).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const players = (await listPlayers(room.id)).filter((p) => p.role === "player");
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      fail(409, `Ai nevoie de ${MIN_PLAYERS}-${MAX_PLAYERS} jucători la masă. Acum sunt ${players.length}.`);
    }
    const notReady = players.filter((p) => !p.ready && p.id !== room.host_player_id);
    if (notReady.length > 0) fail(409, `Nu sunt toți ready: ${notReady.map((p) => p.nickname).join(", ")}.`);

    const seats = players.map((p) => p.id); // listPlayers already sorts by seat, then join time
    const names = seats.map((id) => players.find((p) => p.id === id)!.nickname);
    const game = newGame(seats, names, withDefaults(room.settings), Date.now());
    await saveRoom(room, { status: "playing", game });
    await clearKicks(room.id);

    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
