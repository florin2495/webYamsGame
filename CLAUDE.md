@AGENTS.md

# webYamsGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webYamsGame`, private). Never the work account.
  Local git identity is pinned in `.git/config` (Florin Radu / marchidan.florin24@gmail.com).
- The user connects the repo to Vercel by hand. Once connected, every push to `main` deploys to production:
  https://yams.hailatat.icu (domain added in the Vercel project).
- `vercel.json` pins `"framework": "nextjs"` (the Vercel project was imported while the repo held only a README, so it was detected as "Other" and the build failed looking for `public/`) and `"regions": ["fra1"]`. Functions run in `fra1` (Frankfurt), next to the Supabase DB. Never remove it:
  the Vercel default `iad1` (Washington) makes every DB query cross the Atlantic. After a deploy check that the
  `X-Vercel-Id` response header of an API route reads `fra1::fra1::…`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by `florin2495/hailataticu-hub`, slug `yams`).
- Hub entry: `D:\_DEv\000_Startup\src\games.ts` (slug `yams`, url `https://yams.hailatat.icu`).
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
  spectator; "Rundă nouă" seats spectators while there are free seats. Lobby: everyone except the host presses
  "Sunt ready", then the host starts.
- No cron: the turn timeout (`/timeout`) is triggered lazily by clients (host and current player first, other players
  +3 s, spectators +6 s); the server checks the deadline and `turnKey`, so duplicates are no-ops.
- Idle rooms: lobby/finished closed after `ROOM_IDLE_MINUTES` (2) with nobody on the page, a running game after 60 min.
  Lazy cleanup on room list / create / room access.
- Kick: in the lobby immediate; during a game a 10 s pending kick the player can "Ignoră" (`kick_requested_at`).
- Realtime: Broadcast topic `yams:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.
- Per-device settings (localStorage): sound, vibration, confirm before a 0 box.

## Testing
- `npm test` (Vitest, `src/lib/game.test.ts` incl. full games with 2/5/16 players), `npx tsc --noEmit`,
  `npx eslint src`, `npx next build`.
- End-to-end: `node scripts/e2e.mjs [baseUrl]` (default `http://localhost:3011`) drives the real API with 3 players
  and a spectator: create (with password), join, wrong password, settings, ready, start, roll/hold/score, out-of-turn
  errors, timeout (with 20 s timer), kick with "Ignoră", pending kick enforced, leave mid-game, full game to the end,
  new round (spectator seated), feedback. It deletes its rooms at the end. Dev server: `npm run dev -- -p 3011`
  (`.claude/launch.json` → `yams-dev`).
