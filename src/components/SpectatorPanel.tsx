"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { Card, ErrorText, OfflineBadge } from "./ui";

/** Game screen: who is watching and who is queued for the next round (the lobby has its own list). */
export function SpectatorPanel({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const watching = players.filter((p) => p.role === "observer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function kick(id: string, nickname: string) {
    if (!window.confirm(`Scoți spectatorul ${nickname} din cameră?`)) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/kick`, { token, body: { playerId: id } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }

  if (watching.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-bold">
        👀 Spectatori <span className="font-normal text-zinc-500">{watching.length}</span>
      </h2>
      <ul data-testid="game-spectators" className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {watching.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {s.nickname}
                {s.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {s.queued && (
                <span className="shrink-0 rounded bg-indigo-100 px-1.5 text-[10px] font-semibold uppercase text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                  în coadă
                </span>
              )}
              <OfflineBadge connected={s.connected} />
            </span>
            {isHost && s.id !== me.id && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void kick(s.id, s.nickname)}
                className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                aria-label={`Scoate pe ${s.nickname}`}
              >
                {busy === s.id ? "…" : "Scoate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
