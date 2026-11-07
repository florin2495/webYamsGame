"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { MAX_PLAYERS, MIN_PLAYERS, minutesLabel, ROOM_IDLE_MINUTES } from "@/lib/game";
import type { PublicPlayer, RoomState } from "@/lib/types";
import { TurnSelect } from "./TurnSelect";
import { Button, Card, ErrorText } from "./ui";

export function Lobby({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const { room, me, players } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }

  const seated = players.filter((p) => p.role === "player");
  const watching = players.filter((p) => p.role === "observer");
  const n = seated.length;
  const notReady = seated.filter((p) => !p.ready && !p.isHost);
  const canStart = n >= MIN_PLAYERS && n <= MAX_PLAYERS && notReady.length === 0;

  const setTurn = (turnSeconds: number) => run(() => api(`${base}/settings`, { token, body: { turnSeconds } }));
  const toggleReady = () => run(() => api(`${base}/ready`, { token, body: { ready: !me.ready } }));
  const start = () => run(() => api(`${base}/start`, { token, body: {} }));

  return (
    <>
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">🎲 La masă</h2>
          <span className="text-sm text-zinc-500">
            {n}/{MAX_PLAYERS}
          </span>
        </div>
        <Members list={seated} state={state} token={token} refresh={refresh} empty="Nimeni la masă încă." />
        {n < MIN_PLAYERS && (
          <p className="mt-2 text-sm text-zinc-500">
            Mai trebuie {MIN_PLAYERS - n} {MIN_PLAYERS - n === 1 ? "jucător" : "jucători"}. Apasă pe cod (sus) ca să trimiți invitația.
          </p>
        )}
      </Card>

      {watching.length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold">👀 Spectatori</h2>
          <Members list={watching} state={state} token={token} refresh={refresh} empty="" />
          <p className="mt-2 text-xs text-zinc-500">Masa e plină. Intră la următoarea partidă dacă se eliberează un loc.</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-bold">
          Reguli {!isHost && <span className="text-xs font-normal text-zinc-500">(le alege host-ul)</span>}
        </h2>
        <TurnSelect value={room.settings.turnSeconds} onChange={(v) => void setTurn(v)} disabled={!isHost || busy} />
      </Card>

      <ErrorText>{error}</ErrorText>
      {isHost ? (
        <Button onClick={() => void start()} disabled={busy || !canStart}>
          {n < MIN_PLAYERS
            ? `Ai nevoie de cel puțin ${MIN_PLAYERS} jucători`
            : notReady.length > 0
              ? `Așteptăm ready: ${notReady.map((p) => p.nickname).join(", ")}`
              : `Începe partida (${n} jucători)`}
        </Button>
      ) : me.role === "player" ? (
        <>
          <Button variant={me.ready ? "secondary" : "primary"} onClick={() => void toggleReady()} disabled={busy}>
            {me.ready ? "✓ Ești ready (apasă ca să anulezi)" : "Sunt ready"}
          </Button>
          <p className="text-center text-sm text-zinc-500">
            {me.ready ? "Așteptăm ca host-ul să înceapă partida…" : "Apasă „Sunt ready” când ești gata."}
          </p>
        </>
      ) : (
        <p className="text-center text-sm text-zinc-500">Ești spectator. Așteptăm ca host-ul să înceapă partida…</p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Camera se închide după {minutesLabel(ROOM_IDLE_MINUTES)} în care nimeni nu o are deschisă.
      </p>
    </>
  );
}

function Members({
  list,
  state,
  token,
  refresh,
  empty,
}: {
  list: PublicPlayer[];
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  empty: string;
}) {
  const { me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function kick(id: string, nickname: string) {
    if (!window.confirm(`Scoți jucătorul ${nickname} din cameră?`)) return;
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

  if (list.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {list.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {p.nickname}
                {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              {p.isHost && <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>}
              {p.role === "player" && !p.isHost && (
                <span
                  className={`rounded px-1.5 text-[10px] font-semibold uppercase ${
                    p.ready ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"
                  }`}
                >
                  {p.ready ? "ready" : "nu e gata"}
                </span>
              )}
            </span>
            {canKick && p.id !== me.id && (
              <button
                type="button"
                onClick={() => void kick(p.id, p.nickname)}
                disabled={busy !== null}
                className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                aria-label={`Scoate pe ${p.nickname}`}
              >
                {busy === p.id ? "…" : "Scoate"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
