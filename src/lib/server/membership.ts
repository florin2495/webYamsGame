import "server-only";
import { isKickExpired, KICK_GRACE_MS, KICK_NETWORK_GRACE_MS } from "@/lib/kick";
import { removeSeat } from "@/lib/game";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { getRoomByCode, listPlayers, saveRoom, withRetry } from "./room";

/**
 * Removes a member from a room (used by both "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to the next member in join order (players before observers)
 *  - a player in a running game is out of the ranking; if it was their turn, the next player goes.
 *    The game ends when nobody is left at the table.
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  let reads = 0;
  const result = await withRetry(
    // First attempt uses the room the caller already read; retries read it again.
    async () => (reads++ === 0 ? room : getRoomByCode(room.code)),
    async (fresh) => {
      const players = await listPlayers(fresh.id);
      const remaining = players.filter((p) => p.id !== playerId);

      if (remaining.length === 0) {
        const { error } = await db().from(T.rooms).delete().eq("id", fresh.id);
        if (error) throw error;
        return { roomClosed: true, newHostId: null as string | null, changedHost: false };
      }

      const nextHost = remaining.find((p) => p.role === "player") ?? remaining[0];
      const newHostId = fresh.host_player_id === playerId ? nextHost.id : fresh.host_player_id;
      const update: Partial<RoomRow> = { host_player_id: newHostId };
      const seat = fresh.game ? fresh.game.seats.indexOf(playerId) : -1;
      if (fresh.status === "playing" && fresh.game && seat >= 0) {
        const game = removeSeat(fresh.game, seat, Date.now());
        update.game = game;
        if (game.phase === "over") update.status = "finished";
      }
      // Update the room first so the host never points at a deleted player.
      await saveRoom(fresh, update);
      return { roomClosed: false, newHostId, changedHost: newHostId !== fresh.host_player_id };
    },
  );
  if (result.roomClosed) return { roomClosed: true };

  if (result.changedHost && result.newHostId) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", result.newHostId);
    if (error) throw error;
  }
  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}

/** Clears every pending kick of a room (new game, back to the lobby). */
export async function clearKicks(roomId: string): Promise<void> {
  const { error } = await db().from(T.players).update({ kick_requested_at: null }).eq("room_id", roomId).not("kick_requested_at", "is", null);
  if (error) throw error;
}

/**
 * Lazy enforcement (no timers on serverless): removes players whose pending kick ran out, exactly like an
 * immediate kick (removePlayer). Each removal is claimed atomically (clear the column only if it still holds
 * the value we read), so concurrent requests never remove the same player twice. Returns the room to keep
 * working with: re-read after a removal, or the room as given when nothing expired.
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<RoomRow> {
  const cutoff = new Date(Date.now() - (KICK_GRACE_MS + KICK_NETWORK_GRACE_MS)).toISOString();
  const { data, error } = await db()
    .from(T.players)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .lt("kick_requested_at", cutoff);
  if (error) throw error;
  let current = room;
  let removed = false;
  for (const row of (data ?? []) as { id: string; kick_requested_at: string }[]) {
    if (!isKickExpired(row.kick_requested_at, Date.now())) continue;
    const claim = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", row.id)
      .eq("kick_requested_at", row.kick_requested_at)
      .select("id");
    if (claim.error) throw claim.error;
    if (!claim.data || claim.data.length === 0) continue; // another request claimed it
    try {
      const { roomClosed } = await removePlayer(current, row.id, "player_kicked");
      removed = true;
      if (roomClosed) break;
      current = await getRoomByCode(room.code);
    } catch (err) {
      // Give the kick back so a later request retries it.
      await db().from(T.players).update({ kick_requested_at: row.kick_requested_at }).eq("id", row.id);
      throw err;
    }
  }
  return removed ? getRoomByCode(room.code) : room;
}
