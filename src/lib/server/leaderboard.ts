import "server-only";
import { type GameState, standings } from "@/lib/game";
import { db } from "./db";

const GAME = "yams";

/** player_key = nickname, lowercase, trimmed (no accounts: same nickname = same person). */
export const playerKey = (nickname: string) => nickname.trim().toLowerCase().slice(0, 40);

/**
 * Contract C: reports a finished round to the hub's shared leaderboard (hub_leaderboard*, owned by the hub).
 * Idempotent: the (game, room, round) row in hub_leaderboard_rounds is claimed first, so a round is counted once
 * even when several requests see the game end. Players who left mid-game are not counted. Never throws: a
 * leaderboard problem must not break the game.
 */
export async function reportRound(roomCode: string, roundNo: number, game: GameState): Promise<void> {
  try {
    const claim = await db().from("hub_leaderboard_rounds").insert({ game: GAME, room_code: roomCode, round_no: roundNo });
    if (claim.error) {
      if (claim.error.code !== "23505") console.error("leaderboard claim failed", claim.error);
      return;
    }
    const rows = standings(game).filter((s) => !s.left);
    for (const s of rows) {
      const key = playerKey(s.name);
      const win = s.place === 1 ? 1 : 0;
      const { data, error } = await db()
        .from("hub_leaderboard")
        .select("wins, games")
        .eq("game", GAME)
        .eq("player_key", key)
        .maybeSingle();
      if (error) throw error;
      const { error: upError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: key,
            display_name: s.name.trim().slice(0, 40),
            wins: (data?.wins ?? 0) + win,
            games: (data?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upError) throw upError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
