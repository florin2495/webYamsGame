import "server-only";
import { type GameState, RuleError } from "@/lib/game";
import { notifyRoom } from "./broadcast";
import type { PlayerRow, RoomRow } from "./db";
import { fail, handle, readJson } from "./http";
import { reportRound } from "./leaderboard";
import { buildState, requireMember, requireStatus, saveRoom, withRetry } from "./room";

export interface MoveContext {
  room: RoomRow;
  player: PlayerRow;
  /** Caller's seat in the game, -1 for observers. */
  seat: number;
  isHost: boolean;
  body: Record<string, unknown>;
  now: number;
}

/**
 * Shared body of every in-game write (roll, score, timeout): authenticates the caller,
 * applies the pure rule `apply` to the stored state and saves it with the optimistic lock
 * (retrying on a concurrent write). Answers with the caller's new RoomState. A finished game flips the room to "finished".
 */
export function moveHandler(
  req: Request,
  code: string,
  kind: string,
  apply: (game: GameState, ctx: MoveContext) => GameState,
): Promise<Response> {
  return handle(async () => {
    const body = req.headers.get("content-type")?.includes("json") ? await readJson(req) : {};
    const result = await withRetry(
      () => requireMember(req, code),
      async ({ room, player }) => {
        requireStatus(room, "playing");
        const game = room.game;
        if (!game) fail(409, "Partida nu a început încă.");
        const ctx: MoveContext = {
          room,
          player,
          seat: game.seats.indexOf(player.id),
          isHost: room.host_player_id === player.id,
          body,
          now: Date.now(),
        };
        let next: GameState;
        try {
          next = apply(game, ctx);
        } catch (err) {
          if (err instanceof RuleError) fail(409, err.message);
          throw err;
        }
        const update = { game: next, ...(next.phase === "over" ? { status: "finished" as const } : {}) };
        await saveRoom(room, update);
        return { roomId: room.id, room: { ...room, ...update }, player, finished: next.phase === "over" ? { room: { code: room.code, name: room.name, round: room.round }, game: next } : null };
      },
    );
    if (result.finished) await reportRound(result.finished.room, result.finished.game);
    await notifyRoom(result.roomId, kind);
    // The caller gets the new state right away: no /state round trip after its own action.
    return { ok: true, state: await buildState(result.room, result.player) };
  });
}
