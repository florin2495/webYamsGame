import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ from: h.from }) }));

import type { GameState } from "@/lib/game";
import { isTestRoom, reportRound } from "./leaderboard";

describe("isTestRoom", () => {
  it("matches the e2e room names only", () => {
    expect(isTestRoom("e2e-test-abc")).toBe(true);
    expect(isTestRoom("e2e-test-ui-abc")).toBe(true);
    expect(isTestRoom("Masa lui Ion")).toBe(false);
    expect(isTestRoom("my e2e-test-room")).toBe(false);
    expect(isTestRoom("e2e-tes")).toBe(false);
  });
});

describe("reportRound", () => {
  beforeEach(() => h.from.mockReset());

  it("never touches the leaderboard for a test room", async () => {
    await reportRound({ code: "ABCDEF", name: "e2e-test-ui-x", round: 1 }, {} as GameState);
    expect(h.from).not.toHaveBeenCalled();
  });
});
