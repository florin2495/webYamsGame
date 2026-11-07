// End-to-end test of the Yams API with real players. Usage: node scripts/e2e.mjs [baseUrl]
// Needs the yams_ tables in the DB. Deletes every room it creates (leave, then a DB delete as a safety net).
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3011";
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;

/** The player on turn rolls twice (keeping pairs) and writes the best free box. */
async function playTurn(code, p) {
  let s = await state(code, p);
  const t = s.game.turnKey;
  await call(`/api/rooms/${code}/roll`, { token: p.token, body: { turn: t, held: [false, false, false, false, false] } });
  s = await state(code, p);
  const dice = s.game.dice;
  const counts = dice.map((d) => dice.filter((x) => x === d).length);
  const held = counts.map((c) => c >= 2);
  if (!held.every(Boolean)) await call(`/api/rooms/${code}/roll`, { token: p.token, body: { turn: t, held } });
  s = await state(code, p);
  const sheet = s.game.seats[s.game.mySeat].sheet;
  const { scoreFor, CATEGORIES } = await rules();
  let best = null;
  for (const c of CATEGORIES) if (sheet[c] === undefined && (best === null || scoreFor(c, s.game.dice) > scoreFor(best, s.game.dice))) best = c;
  return call(`/api/rooms/${code}/score`, { token: p.token, body: { turn: t, category: best } });
}

// Minimal copy of the scoring needed to pick a box (the server re-checks everything).
async function rules() {
  const CATEGORIES = ["ones", "twos", "threes", "fours", "fives", "sixes", "brelan", "carre", "full", "smallStraight", "largeStraight", "yams", "chance"];
  const scoreFor = (c, d) => {
    const n = [0, 0, 0, 0, 0, 0, 0];
    d.forEach((x) => n[x]++);
    const sum = d.reduce((a, b) => a + b, 0);
    const max = Math.max(...n);
    const run = (len) => {
      let r = 0;
      for (let v = 1; v <= 6; v++) if ((r = n[v] ? r + 1 : 0) >= len) return true;
      return false;
    };
    const i = CATEGORIES.indexOf(c);
    if (i < 6) return (i + 1) * n[i + 1];
    return { brelan: max >= 3 ? sum : 0, carre: max >= 4 ? sum : 0, full: n.includes(3) && n.includes(2) ? 25 : 0, smallStraight: run(4) ? 30 : 0, largeStraight: run(5) ? 40 : 0, yams: max === 5 ? 50 : 0, chance: sum }[c];
  };
  return { CATEGORIES, scoreFor };
}

async function main() {
  console.log(`E2E against ${BASE}`);

  console.log("Room, join, settings");
  const r = await call("/api/rooms", { body: { name: "E2E Yams", nickname: "Ana", password: "pw", turnSeconds: 20 } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  const join = async (nickname) => ({ ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw" } })).data, name: nickname });
  const B = await join("Bob");
  const C = await join("Cris");
  const E = await join("Ema");
  check(B.role === "player" && C.role === "player" && E.role === "player", "3 players joined in the lobby");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw" } })).status === 409, "duplicate nickname = 409");
  const list = await call("/api/rooms");
  check(list.data.rooms?.some((x) => x.code === code && x.hasPassword && x.players === 4), "room in public list, with password and 4 players");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { turnSeconds: 30 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 33 } })).status === 400, "33 s turn = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 20 } })).status === 200, "host sets 20 s");

  console.log("Ready and start");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with players not ready = 409");
  for (const p of [B, C, E]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  let s = await state(code, A);
  check(s.players.filter((p) => p.ready).length === 3, "3 players ready");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  s = await state(code, A);
  check(s.room.status === "playing" && s.game.turn === 0 && s.game.seats[0].name === "Ana", "host plays first");

  console.log("Turns");
  check((await call(`/api/rooms/${code}/roll`, { token: B.token, body: { held: [] } })).status === 409, "roll out of turn = 409");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { category: "chance" } })).status === 409, "score before rolling = 409");
  let t = s.game.turnKey;
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [false, false, false, false, false] } })).status === 200, "roll 1");
  const d1 = (await state(code, A)).game.dice;
  await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [true, true, false, false, false] } });
  s = await state(code, B);
  check(s.game.dice[0] === d1[0] && s.game.dice[1] === d1[1] && s.game.rolls === 2, "roll 2 keeps held dice, seen by others");
  await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [true, true, false, false, false] } });
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [] } })).status === 409, "4th roll = 409");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "chance" } })).status === 200, "score Șansă");
  s = await state(code, A);
  check(s.game.turn === 1 && s.game.seats[0].sheet.chance === s.game.last.points &&s.game.rolls === 0, "turn passes to Bob");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "ones" } })).status === 409, "stale turnKey = 409");

  console.log("Spectator");
  const D = { ...(await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw" } })).data, name: "Dan" };
  check(D.role === "observer", "joining mid-game = spectator");
  check((await call(`/api/rooms/${code}/roll`, { token: D.token, body: { held: [] } })).status === 403, "spectator roll = 403");
  check((await call(`/api/rooms/${code}/timeout`, { token: D.token, body: { turn: s.game.turnKey } })).status === 409, "early timeout = 409");

  console.log("Kick with Ignoră");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: C.playerId } })).data.pending === true, "kick in game is pending");
  s = await state(code, C);
  check(s.me.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: C.token, body: {} })).status === 200, "Ignoră");
  check((await state(code, C)).me.kickRemainingMs === null, "kick cleared");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: C.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "kick enforced after 12 s");
  s = await state(code, A);
  check(s.game.seats[2].left === true, "kicked player out of the ranking");

  console.log("Timeout");
  const wait = s.game.turnDeadline + 1_700 - s.serverNow;
  if (wait > 0) await sleep(wait);
  const bobTurn = s.game.turnKey;
  check((await call(`/api/rooms/${code}/timeout`, { token: D.token, body: { turn: bobTurn } })).status === 200, "timeout after 20 s");
  check((await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: bobTurn } })).status === 409, "repeated timeout = 409 (no-op)");
  s = await state(code, A);
  check(s.game.last.auto === true && s.game.last.seat === 1 && Object.keys(s.game.seats[1].sheet).length === 1, "Bob's turn played automatically");
  check(s.game.turn === 3 && s.game.seats[1].timeouts === 1, "Cris skipped, Ema on turn");

  console.log("Leave mid-game, play to the end");
  check((await call(`/api/rooms/${code}/leave`, { token: E.token, body: {} })).status === 200, "Ema leaves on her turn");
  s = await state(code, A);
  check(s.game.turn === 0, "turn passes to Ana");
  const byId = { [A.playerId]: A, [B.playerId]: B };
  let guard = 0;
  while (s.room.status === "playing" && guard++ < 40) {
    const p = byId[s.game.seats[s.game.turn].playerId];
    const res = await playTurn(code, p);
    if (res.status !== 200) {
      check(false, `turn failed: ${res.status} ${res.data.error}`);
      break;
    }
    s = await state(code, A);
  }
  check(s.room.status === "finished" && s.game.phase === "over", `game over after ${guard} more turns`);
  check(s.game.seats.filter((x) => !x.left).every((x) => Object.keys(x.sheet).length === 13), "every remaining sheet is full");
  check(s.game.standings[0].place === 1 && s.game.standings.at(-1).place === null, "standings ranked, leavers last");

  console.log("New round");
  check((await call(`/api/rooms/${code}/new-round`, { token: D.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = await state(code, D);
  check(s.room.status === "lobby" && s.room.round === 2 && s.me.role === "player" && s.players.every((p) => !p.ready), "spectator seated, ready reset");

  console.log("Feedback (no rows written)");
  check((await call("/api/feedback", { body: { message: "", nickname: "e2e" } })).status === 400, "empty feedback = 400");
  check((await call("/api/feedback", { body: { message: "e2e", website: "bot" } })).status === 200, "honeypot accepted, not stored");

  console.log("Cleanup");
  for (const p of [B, D]) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/yams_rooms?code=in.(${[...created].join(",")})`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
