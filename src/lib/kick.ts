// Pending kick: during a running tournament the host's kick gives the player KICK_GRACE_MS to press "Ignoră".
// Pure helpers, shared by server and client.

/** How long a kicked player has to press "Ignoră". */
export const KICK_GRACE_MS = 10_000;
/** Network grace on top of KICK_GRACE_MS: "Ignoră" is still accepted, and the removal is enforced only after it. */
export const KICK_NETWORK_GRACE_MS = 2_000;

/** Ms left for a pending kick, clamped to [0, KICK_GRACE_MS]. null = no pending kick. */
export function kickRemainingMs(requestedAt: string | number | null | undefined, now: number): number | null {
  if (requestedAt === null || requestedAt === undefined) return null;
  const at = typeof requestedAt === "number" ? requestedAt : Date.parse(requestedAt);
  if (!Number.isFinite(at)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, at + KICK_GRACE_MS - now));
}

/** True once the kick is old enough to be enforced (and "Ignoră" is too late). */
export function isKickExpired(requestedAt: string | number | null | undefined, now: number): boolean {
  if (requestedAt === null || requestedAt === undefined) return false;
  const at = typeof requestedAt === "number" ? requestedAt : Date.parse(requestedAt);
  return Number.isFinite(at) && now - at > KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;
}
