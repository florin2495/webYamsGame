"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { DEFAULT_SETTINGS, MAX_PLAYERS, NICKNAME_MAX } from "@/lib/game";
import type { RoomListItem } from "@/lib/types";
import { FeedbackButton } from "./FeedbackButton";
import { Rules } from "./Rules";
import { RoomList } from "./RoomList";
import { TurnSelect } from "./TurnSelect";
import { Button, Card, ErrorText, Field } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nickname defaults to the last one used on this device.
  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [turnSeconds, setTurnSeconds] = useState(DEFAULT_SETTINGS.turnSeconds);
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    nicknameRef.current?.focus();
  }

  // Password field is hidden only when the picked room is known to have none.
  const pickedNow = picked?.code === code ? picked : null;
  const showPassword = tab === "create" || !(pickedNow && !pickedNow.hasPassword);
  const onlyWatch = tab === "join" && pickedNow !== null && (pickedNow.status !== "lobby" || pickedNow.players >= MAX_PLAYERS);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, turnSeconds } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, {
              body: { nickname, password },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-2">
        <a href="https://hailatat.icu" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <h1 className="text-4xl font-black tracking-tight">Yams 🎲</h1>
        <p className="mt-1 text-sm text-zinc-500">Clasicul joc cu 5 zaruri, între prieteni, pe telefon. Până la {MAX_PLAYERS} jucători.</p>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card>
          <h2 className="mb-3 font-bold">Camere deschise</h2>
          <RoomList selected={pickedNow?.code ?? null} onSelect={pickRoom} onRejoin={(c) => router.push(`/room/${c}`)} />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : pickedNow ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && pickedNow?.hasPassword === true}
            />
          )}
          {tab === "create" && <TurnSelect value={turnSeconds} onChange={setTurnSeconds} />}
          {onlyWatch && (
            <p className="text-xs text-zinc-500">Partida a început sau masa e plină: intri ca spectator și joci de la următoarea partidă.</p>
          )}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : onlyWatch ? "Intră ca spectator" : "Intră în cameră"}
          </Button>
        </form>
      </Card>

      <Rules />
    </main>
  );
}
