import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Minimal stand-in for the Supabase query builder used by cleanupAbandonedRooms:
//   select: from(rooms).select(...).lt("last_activity_at", cutoff).limit(n)       -> { data, error }
//   delete: from(rooms).delete().in("id", ids).lt("last_activity_at", cutoff)     -> { error }
const h = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[] | null, error: null as unknown },
  deleteResult: { error: null as unknown },
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("./db", () => {
  const chain = (kind: "select" | "delete") => {
    const q: Record<string, (...args: unknown[]) => unknown> = {};
    for (const op of ["select", "delete", "in", "eq", "lt", "limit"]) {
      q[op] = (...args: unknown[]) => {
        h.calls.push({ op: `${kind}.${op}`, args });
        if (kind === "select" && op === "limit") return Promise.resolve(h.selectResult);
        if (kind === "delete" && op === "lt") return Promise.resolve(h.deleteResult);
        return q;
      };
    }
    return q;
  };
  return {
    T: { rooms: "yams_rooms", players: "yams_players" },
    ROOM_COLUMNS: "",
    PLAYER_COLUMNS: "",
    db: () => ({
      from: () => ({
        select: (...args: unknown[]) => chain("select").select(...args),
        delete: (...args: unknown[]) => chain("delete").delete(...args),
      }),
    }),
  };
});

import { ROOM_ABANDONED_MS } from "@/lib/game";
import { cleanupAbandonedRooms } from "./room";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const old = ago(ROOM_ABANDONED_MS + 60_000);

const deletes = () => h.calls.filter((c) => c.op.startsWith("delete."));

describe("cleanupAbandonedRooms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    h.calls.length = 0;
    h.selectResult = { data: [], error: null };
    h.deleteResult = { error: null };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("only looks at rooms idle for longer than ROOM_ABANDONED_MS", async () => {
    await cleanupAbandonedRooms();
    const lt = h.calls.find((c) => c.op === "select.lt");
    expect(lt?.args).toEqual(["last_activity_at", ago(ROOM_ABANDONED_MS)]);
    expect(deletes()).toHaveLength(0);
  });

  it("keeps rooms with a recently seen member and deletes silent ones", async () => {
    h.selectResult = {
      data: [
        { id: "kept", last_activity_at: old, players: [{ last_seen_at: old }, { last_seen_at: ago(30_000) }] },
        { id: "silent", last_activity_at: old, players: [{ last_seen_at: old }, { last_seen_at: null }] },
        { id: "empty", last_activity_at: old, players: [] },
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    const inCall = h.calls.find((c) => c.op === "delete.in");
    expect(inCall?.args).toEqual(["id", ["silent", "empty"]]);
  });

  it("re-checks the activity cutoff in the delete itself", async () => {
    h.selectResult = { data: [{ id: "silent", last_activity_at: old, players: [] }], error: null };
    await cleanupAbandonedRooms();
    const lt = h.calls.find((c) => c.op === "delete.lt");
    expect(lt?.args).toEqual(["last_activity_at", ago(ROOM_ABANDONED_MS)]);
  });

  it("deletes nothing when every room has a recent member", async () => {
    h.selectResult = { data: [{ id: "kept", last_activity_at: old, players: [{ last_seen_at: ago(1_000) }] }], error: null };
    await cleanupAbandonedRooms();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a select error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.selectResult = { data: null, error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a delete error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.selectResult = { data: [{ id: "silent", last_activity_at: old, players: [] }], error: null };
    h.deleteResult = { error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
