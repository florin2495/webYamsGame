import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_GRACE_MS, KICK_NETWORK_GRACE_MS, kickRemainingMs } from "./kick";

describe("kickRemainingMs", () => {
  const at = Date.parse("2026-01-01T00:00:00Z");
  it("is null without a pending kick", () => {
    expect(kickRemainingMs(null, at)).toBeNull();
    expect(kickRemainingMs(undefined, at)).toBeNull();
    expect(kickRemainingMs("garbage", at)).toBeNull();
  });
  it("counts down from the grace period and clamps to [0, grace]", () => {
    expect(kickRemainingMs("2026-01-01T00:00:00Z", at)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(at, at + 4_000)).toBe(6_000);
    expect(kickRemainingMs(at, at + KICK_GRACE_MS)).toBe(0);
    expect(kickRemainingMs(at, at + 60_000)).toBe(0);
    expect(kickRemainingMs(at, at - 5_000)).toBe(KICK_GRACE_MS); // clock skew: never above the grace
  });
});

describe("isKickExpired", () => {
  const at = 1_000_000;
  it("is false without a kick and inside grace + network grace", () => {
    expect(isKickExpired(null, at)).toBe(false);
    expect(isKickExpired(at, at + KICK_GRACE_MS)).toBe(false);
    expect(isKickExpired(at, at + KICK_GRACE_MS + KICK_NETWORK_GRACE_MS)).toBe(false);
  });
  it("is true after grace + network grace", () => {
    expect(isKickExpired(at, at + KICK_GRACE_MS + KICK_NETWORK_GRACE_MS + 1)).toBe(true);
    expect(isKickExpired(new Date(at).toISOString(), at + 60_000)).toBe(true);
  });
});
