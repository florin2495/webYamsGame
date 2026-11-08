"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import type { RoomState } from "@/lib/types";
import { Button, ErrorText } from "./ui";

/** Spectator: "Intră la runda următoare" (toggle). Queued spectators are seated, in order, at the next round. */
export function QueueButton({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (me.role !== "observer") return null;

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rooms/${room.code}/queue`, { token, body: { queued: !me.queued } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={me.queued ? "secondary" : "primary"} onClick={() => void toggle()} disabled={busy}>
        {me.queued ? "✓ Ești în coadă pentru runda următoare (anulează)" : "Intră la runda următoare"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
