@AGENTS.md

# webYamsGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webYamsGame`, private). Never the work account.
  Local git identity is pinned in `.git/config` (Florin Radu / marchidan.florin24@gmail.com).
- The user connects the repo to Vercel by hand. Once connected, every push to `main` deploys to production:
  https://games.hailatat.icu/yams (the hub proxies `/yams/*` to this project; `basePath: "/yams"` in `next.config.ts`).
- `vercel.json` pins `"framework": "nextjs"` (the Vercel project was imported while the repo held only a README, so it was detected as "Other" and the build failed looking for `public/`) and `"regions": ["fra1"]`. Functions run in `fra1` (Frankfurt), next to the Supabase DB. Never remove it:
  the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic. After a deploy check that the
  `X-Vercel-Id` response header of an API route reads `fra1::fra1::…`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `yams`).
- Hub entry: `D:\_DEv\000_Startup\src\games.ts` (slug `yams`, url `/yams`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as the other hub games)
One Supabase project hosts every hailatat.icu mini-game. **Every object of this game starts with `yams_`**
(tables, constraints, indexes). Table names live in `T` in `src/lib/server/db.ts`. Never touch other games' tables.
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-07, verified: columns selectable, anon gets 401) | `yams_rooms` (game state in jsonb `game`), `yams_players` (`role`, `ready`, `kick_requested_at`) |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `yams_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Do not push before it is applied |
| `supabase/migrations/003_seat_queue.sql` | **NO - user must run it** | `yams_players.seat` (host-chosen order, contract A) + `queued_at` (spectator queue, contract B). `/reorder`, `/queue`, start and new-round need it. Do not push before it is applied |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/` (`002_…sql`, …), additive when possible, and the same
  change folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local` (`node .claude/scripts/checkdb.mjs`, gitignored).
- Never print or commit the keys in `.env.local`.

## Design
- Pure rules in `src/lib/game.ts`: one score column, 13 boxes in any order; upper bonus +35 at ≥ 63; Brelan / Careu =
  sum of all dice, Full 25, Chintă mică 30, Chintă mare 40, Yams 50, Șansă = sum; every extra Yams after a Yams scored 50
  gives +100 (dice go in another box as usual, no joker rule). 3 rolls per turn, players take turns (host first, then
  join order).
- Turn timer 20-60 s (room setting, step 5). On expiry `forceTurn`: roll once if the player has not rolled, then the
  free box worth the most (ties: first in sheet order). Consecutive timeouts are only shown (no auto-skip).
- The whole game state is one jsonb column `yams_rooms.game`, written with an optimistic lock on `yams_rooms.version`
  (`saveRoom`, retried by `withRetry`). Everything is public (dice, holds, sheets).
- Members: `yams_players.role` = `player` (max 16) or `observer` (spectator, max 16). Joining during or after a game =
  spectator; spectators press "Intră la runda următoare" (`POST /queue`, toggle; immediate in the lobby when a seat is free); "Rundă nouă" seats the queue in order while there are free seats. Lobby: everyone except the host presses
  "Sunt ready", then the host starts.
- No cron: the turn timeout (`/timeout`) is triggered lazily by clients (host and current player first, other players
  +3 s, spectators +6 s); the server checks the deadline and `turnKey`, so duplicates are no-ops.
- Idle rooms: lobby/finished closed after `ROOM_IDLE_MINUTES` (10) with nobody on the page, a running game after 60 min.
  Lazy cleanup on room list / create / room access.
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
  re-joining with an existing nickname reclaims that seat (new token, same role, pending kick dropped) from the same
  device (`device_hash`) or once the seat has been unseen for 45 s, also mid-game. `/state` exposes only a derived
  `connected` flag ("deconectat" badge). Home shows "Revino în camera …" for stored sessions that are still valid.
- Kick: in the lobby immediate; during a game a 10 s pending kick the player can "Ignoră" (`kick_requested_at`).
- Realtime: Broadcast topic `yams:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.
- Per-device settings (localStorage): sound, vibration, confirm before a 0 box.

- Leaderboard (contract C): `src/lib/server/leaderboard.ts` `reportRound` upserts `hub_leaderboard` (game `yams`, player_key = lowercase nickname) once per (room, round) via `hub_leaderboard_rounds`; winners = place 1, players who left are not counted. Needs the hub's `002_hub_leaderboard.sql` applied (hub-owned). Never throws.

## Testing
- `npm test` (Vitest, `src/lib/game.test.ts` incl. full games with 2/5/16 players, `kick.test.ts`, `reconnect.test.ts`), `npx tsc --noEmit`,
  `npx eslint src`, `npx next build`.
- End-to-end: `node scripts/e2e.mjs [baseUrl] [vercelUrl]` (default production `https://games.hailatat.icu/yams`;
  local: `http://localhost:3011/yams`) first checks page / `_next` assets / manifest / icons / `room/XXXXXX` over HTTP
  and that `011web-yams-game.vercel.app/yams` serves the same build, then drives the real API with 3 players and a
  spectator: create (with password), join, wrong/missing password, forged/missing token, rejoin with the saved token and
  by nickname (same device = reclaim, other device = 409, old token dead, also mid-game), lobby kick/leave, settings,
  ready, start, roll/hold/score, illegal moves, out-of-turn errors, same view for everyone, timeout (20 s timer), kick
  with "Ignoră", pending kick enforced, leave mid-game, full game to the end (totals and winner checked), new round
  (spectator seated). Rooms are named `e2e-test-…` and deleted at the end; it never calls `/api/feedback`.
  Dev server: `npm run dev -- -p 3011` (`.claude/launch.json` → `yams-dev`).
