@AGENTS.md

# webYamsGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webYamsGame`, public). Never the work account.
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
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `yams_players.last_seen_at`, `device_hash` + index (rejoin the same seat). |
| `supabase/migrations/003_seat_queue.sql` | yes (2026-11-08, verified: seat/queued_at selectable with service role; verified again 2026-11-14 by effect: production E2E exercises its columns) | `yams_players.seat` (host-chosen order, contract A) + `queued_at` (spectator queue, contract B). `/reorder`, `/queue`, start and new-round need it. |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/` (`002_…sql`, …), additive when possible, and the same
  change folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local` (`node .claude/scripts/checkdb.mjs`, gitignored).
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (600 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (600 s, `game.ts`)
  and with no player/spectator (`yams_players`, both roles) `last_seen_at` within 600 s is deleted (players cascade).
  Open room pages keep both fresh (`/state` polls every 60 s, touches `last_seen_at` ≤ 10 s and `last_activity_at`
  ≤ 20 s), so only rooms nobody has open disappear; the page shows its neutral "room gone" screen on the next 404
  ("Camera nu mai există (a fost închisă după inactivitate)."). Unit-tested with the DB mocked in
  `src/lib/server/room.test.ts`. The 10 / 60-minute idle expiry stays too.

## Design
- Pure rules in `src/lib/game.ts`: one score column, 13 boxes in any order; upper bonus +35 at ≥ 63; Brelan / Careu =
  sum of all dice, Full 25, Chintă mică 30, Chintă mare 40, Yams 50, Șansă = sum; every extra Yams after a Yams scored 50
  gives +100 (dice go in another box as usual, no joker rule). 3 rolls per turn, players take turns (host first: the creator
  gets seat 0, then the lobby order).
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
  device (`device_hash`) or once the seat has been unseen for 301 s (`DISCONNECT_MS`), also mid-game. `/state` exposes only a derived
  `connected` flag ("deconectat" badge). Home shows "Revino în camera …" for stored sessions that are still valid.
- Kick: in the lobby immediate; during a game a 10 s pending kick the player can "Ignoră" (`kick_requested_at`).
- Realtime: Broadcast topic `yams:room:<uuid>` carries no data, clients re-fetch `/state`; 60 s polling fallback.
- Per-device settings (localStorage): sound, vibration, confirm before a 0 box.

- Leaderboard (contract C): `src/lib/server/leaderboard.ts` `reportRound` upserts `hub_leaderboard` (game `yams`, player_key = lowercase nickname) once per (room, round) via `hub_leaderboard_rounds`; winners = place 1, players who left are not counted; test rooms (name starts with `e2e-test-`, `isTestRoom`) are never reported. Needs the hub's `002_hub_leaderboard.sql` applied (hub-owned). Never throws.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed
runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger, the user's choice): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest, `vitest.config.ts` maps the `@/` alias: `src/lib/game.test.ts` incl. full games with 2/5/16 players, `kick.test.ts`, `reconnect.test.ts`, `server/room.test.ts` (abandoned-room cleanup) and `server/leaderboard.test.ts` (test rooms skipped), with `server-only` and the db module mocked; no real DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/yams`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does (`scripts/e2e.mjs [baseUrl] [vercelUrl]`, Node built-ins only): checks page / `_next` assets / version
  in the client JS / manifest / icons / `room/XXXXXX` over HTTP and that `011web-yams-game.vercel.app/yams` serves the
  same build, then drives the real API (production DB) with 3 players and a spectator: create (with password), join,
  wrong/missing password, forged/missing token, rejoin with the saved token and by nickname (same device = reclaim,
  other device = 409, old token dead, also mid-game), lobby kick/leave, settings, ready, start, roll/hold/score, illegal
  moves, out-of-turn errors, same view for everyone, spectator 403s, timeout (20 s timer), kick with "Ignoră", pending
  kick enforced, leave mid-game, full game to the end (totals and winner checked), spectator queue, new round (queued spectator seated).
  Rooms are named `e2e-test-…` and deleted at the end; it never calls `/api/feedback`.
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 60 s, so this checks Realtime; dice are random, so each move is picked from the boxes
  the screen offers: roll once, write the best box, a 0 box is confirmed):
  - `game.e2e.ts` (both projects): two browser contexts (= two devices) create a room (60 s turns), join by link,
    ready, start, play the full game (13 rounds each; every roll and turn change seen live by the other), same results
    on both screens, new round followed live, leave.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-game = spectator (no roll button, dice or
    boxes), the players see them in the game screen's spectator list, they queue ("Ești în coadă", the players see
    "în coadă"), sees every roll and turn live, the guest leaves mid-game and the host finishes
    alone, the spectator sees the results ("a plecat"), and the new round seats them.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / lobby / game, dice and score boxes >= 24 px, touch
    taps roll, hold a die and write a box, seen live on the other phone.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets. (Test rooms are never
  reported to the hub leaderboard.)
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit`, `join-submit`, `leave` (RoomClient), `player-list`,
  `spectator-list`, `ready`, `start-game` (Lobby), `queue-toggle` (QueueButton), `turn-badge`, `round`, `dice`
  (`data-roll` = `turnKey|rolls|dice`), `die` (clickable die, `aria-pressed` = held; Dice.tsx), `roll`, `score-box`
  (`data-category`, `data-points`), `score-value` (`data-category`), `spectator-status`, `results`, `new-round` (Game), `game-spectators` (SpectatorPanel, in-game spectator/queue list).
  Renaming or removing one breaks `tests/ui`.
- Dev server (only if the user asks): `npm run dev -- -p 3011` (`.claude/launch.json` → `yams-dev`).
