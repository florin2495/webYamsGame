"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/** Ms left of a pending kick now: the value the server sent minus the time since that state arrived. */
export function localKickMs(state: RoomState, remaining: number | null, deviceNow: number): number | null {
  if (remaining === null || deviceNow === 0) return remaining;
  const arrivedAt = state.serverNow - (state.clockOffset ?? 0); // device time when the state arrived
  return Math.max(0, remaining - Math.max(0, deviceNow - arrivedAt));
}

/**
 * Blocking modal for the player the host kicked during a game, plus the client side of enforcement:
 * when any pending countdown reaches 0 the state is refreshed (once, and once more after the server's
 * network grace), so the removal happens promptly even though polling is slow.
 */
export function KickWatcher({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const deviceNow = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scheduled = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = state.players.filter((p) => p.kickRemainingMs !== null);
    for (const id of scheduled.current) if (!pending.some((p) => p.id === id)) scheduled.current.delete(id);
    for (const p of pending) {
      if (scheduled.current.has(p.id)) continue;
      scheduled.current.add(p.id);
      const left = localKickMs(state, p.kickRemainingMs, Date.now()) ?? 0;
      timers.current.push(window.setTimeout(() => void refresh(), left + 100));
      timers.current.push(window.setTimeout(() => void refresh(), left + 2_600)); // after the server's 2 s network grace
    }
  }, [state, refresh]);
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const mine = localKickMs(state, state.me.kickRemainingMs, deviceNow);
  if (mine === null) return null;
  const seconds = Math.ceil(mine / 1000);

  async function ignore() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${state.room.code}/kick/ignore`, { token, body: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kick-title"
        aria-describedby="kick-text"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-center text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
      >
        <h2 id="kick-title" className="text-lg font-black">
          Ai fost scos din joc
        </h2>
        <p id="kick-text" className="mt-2 text-sm">
          Gazda te-a scos din cameră. Apasă „Ignoră” în {seconds} s ca să rămâi în joc.
        </p>
        <p className="my-3 font-mono text-4xl font-black text-rose-600 dark:text-rose-400" aria-hidden="true">
          {seconds}
        </p>
        <ErrorText>{error}</ErrorText>
        <Button className="mt-2 w-full" onClick={() => void ignore()} disabled={busy}>
          Ignoră
        </Button>
      </div>
    </div>
  );
}
