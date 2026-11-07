"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import { PREF_CONFIRM_ZERO, PREF_SOUND, PREF_VIBRATE, readPref, useBoolPref } from "@/lib/client/prefs";
import { playRoll, playTurn, playYams } from "@/lib/client/sound";
import {
  CATEGORIES,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  type Category,
  LOWER,
  ROLLS_PER_TURN,
  scoreFor,
  TIMEOUT_GRACE_MS,
  UPPER,
  UPPER_BONUS,
  UPPER_BONUS_AT,
  YAMS_BONUS,
} from "@/lib/game";
import type { PublicGame, PublicSeat, RoomState } from "@/lib/types";
import { Die, MiniDice } from "./Dice";
import { Button, Card, ErrorText } from "./ui";

/** Extra wait before other devices trigger a timeout, so the host's / current player's device goes first. */
const FALLBACK_SEATED_MS = 3_000;
const FALLBACK_SPECTATOR_MS = 6_000;

const noHolds = () => [false, false, false, false, false];

export function Game({ state, token, refresh }: { state: RoomState; token: string; refresh: () => Promise<void> }) {
  const g = state.game!;
  const { room, me } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const deviceNow = useNow();
  const now = deviceNow === 0 ? 0 : deviceNow + (state.clockOffset ?? 0); // server time
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sound] = useBoolPref(PREF_SOUND, true);
  const [vibrate] = useBoolPref(PREF_VIBRATE, true);

  const playing = g.phase === "playing" && room.status === "playing";
  const myTurn = playing && g.mySeat !== null && g.turn === g.mySeat;

  // Dice I want to keep before the next roll (local until I roll). Reset on every new roll / turn.
  const rollId = `${g.turnKey}:${g.rolls}`;
  const [holds, setHolds] = useState<{ id: string; held: boolean[] }>({ id: rollId, held: noHolds() });
  const held = holds.id === rollId ? holds.held : myTurn ? g.held : noHolds();
  const shownHeld = myTurn ? held : g.held;

  const [viewSeat, setViewSeat] = useState<number | null>(null);
  const viewing = viewSeat ?? (playing ? (myTurn || g.mySeat === null ? g.turn : g.mySeat) : (g.mySeat ?? g.standings[0]?.seat ?? 0));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  // Lazy timer: whoever has the page open asks the server to play an expired turn.
  const fired = useRef("");
  const fallback =
    isHost || myTurn ? 0 : g.mySeat !== null ? FALLBACK_SEATED_MS : FALLBACK_SPECTATOR_MS;
  useEffect(() => {
    if (!playing || now === 0 || g.turnDeadline === null) return;
    if (now < g.turnDeadline + TIMEOUT_GRACE_MS + fallback) return;
    if (fired.current === g.turnKey) return;
    fired.current = g.turnKey;
    api(`${base}/timeout`, { token, body: { turn: g.turnKey } })
      .catch(() => undefined) // someone else was first, or the turn changed
      .finally(() => void refresh());
  }, [now, playing, g.turnDeadline, g.turnKey, fallback, base, token, refresh]);

  // Sounds and vibration.
  const seenRoll = useRef(rollId);
  const seenTurn = useRef(g.turnKey);
  useEffect(() => {
    if (seenRoll.current === rollId) return;
    seenRoll.current = rollId;
    if (g.rolls > 0 && sound) playRoll();
  }, [rollId, g.rolls, sound]);
  useEffect(() => {
    if (seenTurn.current === g.turnKey) return;
    seenTurn.current = g.turnKey;
    if (g.last?.yamsBonus || (g.last?.category === "yams" && g.last.points > 0)) {
      if (sound) playYams();
    } else if (myTurn) {
      if (sound) playTurn();
    }
    if (myTurn && vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(200);
  }, [g.turnKey, g.last, myTurn, sound, vibrate]);

  const rollDice = () => run(() => api(`${base}/roll`, { token, body: { turn: g.turnKey, held } }));
  const pick = (category: Category) => {
    const pts = scoreFor(category, g.dice);
    const confirmZero = readPref(PREF_CONFIRM_ZERO) !== "0";
    if (pts === 0 && confirmZero && !window.confirm(`Tai „${CATEGORY_LABEL[category]}” cu 0 puncte?`)) return;
    void run(() => api(`${base}/score`, { token, body: { turn: g.turnKey, category } }));
  };
  const toggleHold = (i: number) => {
    if (!myTurn || g.rolls === 0 || g.rolls >= ROLLS_PER_TURN || busy) return;
    const next = [...held];
    next[i] = !next[i];
    setHolds({ id: rollId, held: next });
  };

  const turnSeat = g.seats[g.turn];
  const secondsLeft = g.turnDeadline !== null && now > 0 ? Math.max(0, Math.ceil((g.turnDeadline - now) / 1000)) : null;
  const pct = secondsLeft !== null ? Math.min(100, (secondsLeft / g.turnSeconds) * 100) : 0;
  const allHeld = held.every(Boolean);

  return (
    <>
      {playing ? (
        <Card className={myTurn ? "ring-2 ring-indigo-500" : ""}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-lg font-black">{myTurn ? "🎯 E rândul tău!" : `Rândul lui ${turnSeat.name}`}</h2>
            <span className="shrink-0 text-sm text-zinc-500">tura {g.round}/13</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full transition-[width] duration-500 ${secondsLeft !== null && secondsLeft <= 5 ? "bg-rose-500" : "bg-indigo-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`w-10 text-right font-mono text-sm font-bold ${secondsLeft !== null && secondsLeft <= 5 ? "text-rose-600" : ""}`}>
              {secondsLeft ?? "–"}s
            </span>
          </div>

          <div className="mt-4 flex justify-center gap-2">
            {g.dice.map((d, i) => (
              <Die
                key={`${i}:${rollId}`}
                value={d}
                held={g.rolls > 0 && shownHeld[i]}
                shaking={g.rolls > 0 && !g.held[i]}
                onClick={myTurn && g.rolls > 0 && g.rolls < ROLLS_PER_TURN ? () => toggleHold(i) : undefined}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-zinc-500">
            {myTurn
              ? g.rolls === 0
                ? "Aruncă zarurile."
                : g.rolls < ROLLS_PER_TURN
                  ? "Atinge zarurile pe care le păstrezi, apoi aruncă din nou, sau alege o căsuță mai jos."
                  : "Gata aruncările. Alege o căsuță mai jos."
              : g.rolls === 0
                ? `${turnSeat.name} nu a aruncat încă.`
                : `Aruncarea ${g.rolls}/${ROLLS_PER_TURN}. Zarurile galbene sunt păstrate.`}
          </p>

          {myTurn && (
            <Button className="mt-3 w-full" onClick={() => void rollDice()} disabled={busy || g.rolls >= ROLLS_PER_TURN || (g.rolls > 0 && allHeld)}>
              {g.rolls === 0 ? "🎲 Aruncă" : g.rolls >= ROLLS_PER_TURN ? "Nu mai ai aruncări" : `🎲 Aruncă din nou (${ROLLS_PER_TURN - g.rolls} rămase)`}
            </Button>
          )}
          <ErrorText>{error}</ErrorText>
        </Card>
      ) : (
        <Results g={g} isHost={isHost} busy={busy} onNewRound={() => void run(() => api(`${base}/new-round`, { token, body: {} }))} error={error} />
      )}

      {g.last && playing && <LastMoveLine g={g} />}

      <Card>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {g.seats.map((s, i) => (
            <button
              key={s.playerId}
              type="button"
              onClick={() => setViewSeat(i)}
              className={`min-h-8 rounded-full border px-2.5 text-xs font-semibold ${
                viewing === i
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                  : "border-zinc-300 dark:border-zinc-700"
              } ${s.left ? "line-through opacity-50" : ""}`}
            >
              {playing && g.turn === i && "▶ "}
              {s.name}
              {g.mySeat === i && " (tu)"} · {s.totals.total}
            </button>
          ))}
        </div>
        <ScoreSheet
          seat={g.seats[viewing]}
          dice={g.dice}
          canPick={myTurn && viewing === g.mySeat && g.rolls > 0 && !busy}
          onPick={pick}
        />
        {playing && g.mySeat !== null && !myTurn && viewing !== g.mySeat && (
          <button type="button" className="mt-2 text-xs font-semibold text-indigo-600 underline" onClick={() => setViewSeat(g.mySeat)}>
            Vezi foaia ta
          </button>
        )}
      </Card>

      {playing && <Standings g={g} />}
      {g.mySeat === null && playing && <p className="text-center text-sm text-zinc-500">Ești spectator: joci de la următoarea partidă.</p>}
    </>
  );
}

function LastMoveLine({ g }: { g: PublicGame }) {
  const l = g.last!;
  return (
    <p className="text-center text-sm text-zinc-600 dark:text-zinc-400" role="status">
      {l.auto && "⏱ "}
      <strong>{g.seats[l.seat].name}</strong> <MiniDice dice={l.dice} /> → {CATEGORY_LABEL[l.category]}{" "}
      <strong>{l.points}</strong>
      {l.yamsBonus && <span className="font-bold text-amber-600"> + {YAMS_BONUS} bonus Yams!</span>}
      {l.auto && <span className="text-xs"> (timp expirat)</span>}
    </p>
  );
}

function ScoreSheet({
  seat,
  dice,
  canPick,
  onPick,
}: {
  seat: PublicSeat;
  dice: number[];
  canPick: boolean;
  onPick: (c: Category) => void;
}) {
  const { sheet, totals: t } = seat;
  const row = (c: Category) => {
    const value = sheet[c];
    const free = value === undefined;
    const potential = free && canPick ? scoreFor(c, dice) : null;
    return (
      <tr key={c} className="border-t border-zinc-100 dark:border-zinc-900">
        <td className="py-1 pr-2">
          <span className="font-medium">{CATEGORY_LABEL[c]}</span>
          <span className="block text-[11px] text-zinc-500">{CATEGORY_HINT[c]}</span>
        </td>
        <td className="w-20 py-1 text-right">
          {potential !== null ? (
            <button
              type="button"
              onClick={() => onPick(c)}
              className={`min-h-9 w-16 rounded-lg border font-mono font-bold ${
                potential > 0
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                  : "border-zinc-300 text-zinc-400 dark:border-zinc-700"
              }`}
              aria-label={`Scrie ${potential} la ${CATEGORY_LABEL[c]}`}
            >
              {potential}
            </button>
          ) : (
            <span className={`font-mono font-bold ${value === 0 ? "text-zinc-400 line-through" : ""}`}>{free ? "" : value}</span>
          )}
        </td>
      </tr>
    );
  };
  const subtotal = (label: string, value: string | number, strong = false) => (
    <tr className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <td className={`py-1 pr-2 text-xs ${strong ? "font-black" : "font-semibold"}`}>{label}</td>
      <td className={`py-1 text-right font-mono ${strong ? "text-lg font-black" : "font-semibold"}`}>{value}</td>
    </tr>
  );
  return (
    <table className="w-full text-sm">
      <tbody>
        {UPPER.map(row)}
        {subtotal(`Total sus (bonus +${UPPER_BONUS} la ${UPPER_BONUS_AT})`, `${t.upper}${t.bonus ? ` +${t.bonus}` : ""}`)}
        {LOWER.map(row)}
        {seat.yamsBonuses > 0 && subtotal(`Bonus Yams ×${seat.yamsBonuses}`, `+${t.yamsBonus}`)}
        {subtotal("TOTAL", t.total, true)}
      </tbody>
    </table>
  );
}

function Standings({ g }: { g: PublicGame }) {
  return (
    <Card>
      <h2 className="mb-2 font-bold">Clasament</h2>
      <ol className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        {g.standings.map((r) => (
          <li key={r.seat} className={`flex items-center justify-between py-1.5 ${r.left ? "opacity-50" : ""}`}>
            <span className="truncate">
              <span className="inline-block w-6 font-mono text-zinc-500">{r.place ?? "–"}</span>
              {r.name}
              {g.mySeat === r.seat && <span className="text-zinc-500"> (tu)</span>}
              {r.left && <span className="text-xs text-zinc-500"> · a plecat</span>}
              {g.seats[r.seat].timeouts >= 2 && !r.left && <span className="text-xs text-amber-600"> · ⏱×{g.seats[r.seat].timeouts}</span>}
            </span>
            <span className="font-mono font-bold">{r.total}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Results({
  g,
  isHost,
  busy,
  onNewRound,
  error,
}: {
  g: PublicGame;
  isHost: boolean;
  busy: boolean;
  onNewRound: () => void;
  error: string;
}) {
  const medal = (p: number | null) => (p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : (p ?? "–"));
  const winners = g.standings.filter((r) => r.place === 1).map((r) => r.name);
  return (
    <Card className="ring-2 ring-amber-400">
      <h2 className="text-center text-xl font-black">🏆 {winners.length > 1 ? `Egalitate: ${winners.join(", ")}` : `A câștigat ${winners[0] ?? "nimeni"}!`}</h2>
      <ol className="mt-3 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {g.standings.map((r) => (
          <li key={r.seat} className={`flex items-center justify-between py-1.5 ${r.left ? "opacity-50" : ""}`}>
            <span className="truncate">
              <span className="inline-block w-8">{medal(r.place)}</span>
              {r.name}
              {g.mySeat === r.seat && <span className="text-zinc-500"> (tu)</span>}
              {r.left && <span className="text-xs text-zinc-500"> · a plecat</span>}
            </span>
            <span className="font-mono text-lg font-bold">{r.total}</span>
          </li>
        ))}
      </ol>
      <AllSheets g={g} />
      <ErrorText>{error}</ErrorText>
      {isHost ? (
        <Button className="mt-3 w-full" onClick={onNewRound} disabled={busy}>
          🎲 Rundă nouă
        </Button>
      ) : (
        <p className="mt-3 text-center text-sm text-zinc-500">Așteptăm ca host-ul să pornească o rundă nouă…</p>
      )}
    </Card>
  );
}

/** Every player's sheet side by side (scrolls sideways with many players). */
function AllSheets({ g }: { g: PublicGame }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">Toate foile de scor</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white pr-2 text-left dark:bg-zinc-950" />
              {g.seats.map((s) => (
                <th key={s.playerId} className="max-w-16 truncate px-1.5 text-right font-semibold">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="sticky left-0 bg-white pr-2 dark:bg-zinc-950">{CATEGORY_LABEL[c]}</td>
                {g.seats.map((s) => (
                  <td key={s.playerId} className={`px-1.5 text-right font-mono ${s.sheet[c] === 0 ? "text-zinc-400" : ""}`}>
                    {s.sheet[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-zinc-300 font-bold dark:border-zinc-700">
              <td className="sticky left-0 bg-white pr-2 dark:bg-zinc-950">Bonusuri</td>
              {g.seats.map((s) => (
                <td key={s.playerId} className="px-1.5 text-right font-mono">
                  {s.totals.bonus + s.totals.yamsBonus || ""}
                </td>
              ))}
            </tr>
            <tr className="border-t border-zinc-300 font-black dark:border-zinc-700">
              <td className="sticky left-0 bg-white pr-2 dark:bg-zinc-950">Total</td>
              {g.seats.map((s) => (
                <td key={s.playerId} className="px-1.5 text-right font-mono">
                  {s.totals.total}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
