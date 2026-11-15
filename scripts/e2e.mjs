// End-to-end test of the Yams API with real players.
// Usage: node scripts/e2e.mjs [baseUrl incl. /yams] [vercelProjectUrl incl. /yams]
// Default: production (https://games.hailatat.icu/yams). Local: node scripts/e2e.mjs http://localhost:3011/yams
// Rooms are named "e2e-test-..."; every room it creates is deleted at the end (leave as everyone, then a DB
// delete of leftovers as a safety net: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else .env.local).
// Sends nothing to /api/feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/yams").replace(/\/$/, "");
const VERCEL = process.argv[3] ?? (BASE.startsWith("https://games.hailatat.icu/") ? "https://011web-yams-game.vercel.app/yams" : null);
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

const assetsOf = (html, basePath) => [...new Set([...html.matchAll(new RegExp(`${basePath}/_next/static/[^"'\\s]+`, "g"))].map((m) => m[0]))].sort();

/** Pages, assets, manifest and icons over plain HTTP, and the Vercel project URL serving the same build. */
async function httpChecks() {
  console.log("HTTP");
  const origin = new URL(BASE).origin;
  const basePath = new URL(BASE).pathname;
  const page = await fetch(BASE, { cache: "no-store" });
  const html = await page.text();
  check(page.status === 200 && html.includes("<html"), `page ${basePath} = ${page.status}`);
  const assets = assetsOf(html, basePath);
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(origin + a)).status));
  check(assets.length > 0 && statuses.every((x) => x === 200), `${assets.length} /_next assets = 200`);
  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  const m = await manifest.json().catch(() => ({}));
  check(manifest.status === 200 && m.start_url === `${basePath}/`, `manifest = ${manifest.status}, start_url ${m.start_url}`);
  const icons = [...(m.icons ?? []).map((i) => i.src), `${basePath}/favicon.ico`, `${basePath}/pwa-icons/apple`];
  const iconRes = await Promise.all(icons.map((src) => fetch(origin + src)));
  check(iconRes.every((x) => x.status === 200 && /image/.test(x.headers.get("content-type") ?? "")), `${icons.length} icons = 200 image/*`);
  check(html.includes(`${basePath}/manifest.webmanifest`) && html.includes(`${basePath}/pwa-icons/apple`), "page links manifest and apple icon under the base path");
  const roomPage = await fetch(`${BASE}/room/XXXXXX`, { cache: "no-store" });
  const roomHtml = await roomPage.text();
  check(roomPage.status === 200, `GET ${basePath}/room/XXXXXX = ${roomPage.status}`);
  // The version is shown in the settings panel (room page): look in the JS chunks of both pages.
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of [...new Set([...assets, ...assetsOf(roomHtml, basePath)])].filter((x) => x.endsWith(".js"))) {
    if ((await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  }
  check(hasVersion, `client JS contains version ${version}`);
  if (VERCEL) {
    const v = await fetch(VERCEL, { cache: "no-store" });
    const vAssets = assetsOf(await v.text(), basePath);
    check(v.status === 200 && vAssets.join() === assets.join(), `${VERCEL} = ${v.status}, same build`);
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();

  console.log("Room, join, settings");
  const roomName = `e2e-test-${Date.now().toString(36)}`;
  const devA = randomUUID();
  const r = await call("/api/rooms", { body: { name: roomName, nickname: "Ana", password: "pw", turnSeconds: 20, deviceId: devA } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana", deviceId: devA };
  check(typeof code === "string" && /^[A-Z2-9]{6}$/.test(code) && typeof A.token === "string", `room code ${code}`);
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname) => {
    const deviceId = randomUUID();
    return { ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId } })).data, name: nickname, deviceId };
  };
  const B = await join("Bob");
  const C = await join("Cris");
  const E = await join("Ema");
  check(B.role === "player" && C.role === "player" && E.role === "player", "3 players joined in the lobby");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw" } })).status === 409, "duplicate nickname = 409");
  const list = await call("/api/rooms");
  const listed = list.data.rooms?.find((x) => x.code === code);
  check(listed?.name === roomName && listed.hasPassword && listed.players === 4 && listed.status === "lobby", "room in public list, with password and 4 players");
  check(!JSON.stringify(list.data).includes("scrypt"), "room list leaks no password hash");

  console.log("Tokens and rejoin (lobby)");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "state without token = 401");
  check((await call(`/api/rooms/${code}/state`, { token: "forged-token" })).status === 401, "state with a forged token = 401");
  check((await call(`/api/rooms/${code}/settings`, { token: "forged-token", body: { turnSeconds: 20 } })).status === 401, "settings with a forged token = 401");
  const reload = await call(`/api/rooms/${code}/state`, { token: B.token });
  check(reload.status === 200 && reload.data.me.id === B.playerId && reload.data.me.nickname === "Bob", "reload with the saved token = same player");
  const raw = JSON.stringify(reload.data);
  check(!/token|device_hash|scrypt/.test(raw) && !raw.includes(A.token), "state leaks no tokens, hashes or device ids");
  const otherDevice = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: randomUUID() } });
  check(otherDevice.status === 409, "rejoin as a connected player from another device = 409");
  const reB = await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: B.deviceId } });
  check(reB.status === 200 && reB.data.playerId === B.playerId && reB.data.role === "player", "rejoin from the same device reclaims the seat");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token is dead after the rejoin");
  if (reB.data.token) B.token = reB.data.token;
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope", deviceId: B.deviceId } })).status === 403, "rejoin with a wrong password = 403");

  console.log("Kick and leave in the lobby");
  const F = await join("Fil");
  check(F.role === "player", "Fil joined");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: F.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicking self = 400");
  const kickF = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: F.playerId } });
  check(kickF.status === 200 && !kickF.data.pending, "lobby kick is immediate");
  check((await call(`/api/rooms/${code}/state`, { token: F.token })).status === 401, "kicked player loses access");
  const G = await join("Gia");
  check((await call(`/api/rooms/${code}/leave`, { token: G.token, body: {} })).status === 200, "Gia leaves the lobby");
  check((await state(code, A)).players.length === 4, "4 members left in the lobby");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { turnSeconds: 30 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 33 } })).status === 400, "33 s turn = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 20 } })).status === 200, "host sets 20 s");

  console.log("Ready and start");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with players not ready = 409");
  for (const p of [B, C, E]) await call(`/api/rooms/${code}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code}/ready`, { token: B.token, body: { ready: "yes" } })).status === 400, "malformed ready = 400");
  let s = await state(code, A);
  check(s.players.filter((p) => p.ready).length === 3, "3 players ready");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  s = await state(code, A);
  check(s.room.status === "playing" && s.game.turn === 0 && s.game.seats[0].name === "Ana", "host plays first");

  console.log("Turns");
  check((await call(`/api/rooms/${code}/roll`, { token: B.token, body: { held: [] } })).status === 400, "malformed held = 400");
  check((await call(`/api/rooms/${code}/roll`, { token: B.token, body: { held: [false, false, false, false, false] } })).status === 409, "roll out of turn = 409");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { category: "chance" } })).status === 409, "score before rolling = 409");
  check((await call(`/api/rooms/${code}/roll`, { token: "forged-token", body: { held: [false, false, false, false, false] } })).status === 401, "roll with a forged token = 401");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start twice = 409");
  let t = s.game.turnKey;
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [false, false, false, false, false] } })).status === 200, "roll 1");
  const d1 = (await state(code, A)).game.dice;
  await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [true, true, false, false, false] } });
  s = await state(code, B);
  check(s.game.dice[0] === d1[0] && s.game.dice[1] === d1[1] && s.game.rolls === 2, "roll 2 keeps held dice, seen by others");
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [true, true, true, true, true] } })).status === 409, "roll with every die held = 409");
  await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [true, true, false, false, false] } });
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { turn: t, held: [false, false, false, false, false] } })).status === 409, "4th roll = 409");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "jackpot" } })).status === 400, "unknown box = 400");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "chance" } })).status === 200, "score Șansă");
  s = await state(code, A);
  check(s.game.turn === 1 && s.game.seats[0].sheet.chance === s.game.last.points &&s.game.rolls === 0, "turn passes to Bob");
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "ones" } })).status === 409, "stale turnKey = 409");
  t = s.game.turnKey;
  await call(`/api/rooms/${code}/roll`, { token: B.token, body: { turn: t, held: [false, false, false, false, false] } });
  check((await call(`/api/rooms/${code}/score`, { token: A.token, body: { turn: t, category: "ones" } })).status === 409, "Ana scoring on Bob's turn = 409");
  const views = await Promise.all([A, B, C, E].map((p) => state(code, p)));
  const strip = (g) => JSON.stringify({ ...g, mySeat: null });
  check(views.every((v) => strip(v.game) === strip(views[0].game)), "every player sees the same game");
  check(views.map((v) => v.game.mySeat).join() === "0,1,2,3", "each player gets their own seat");

  console.log("Rejoin mid-game");
  const sheetBefore = JSON.stringify(views[0].game.seats[0].sheet);
  const reA = await call(`/api/rooms/${code}/join`, { body: { nickname: "Ana", password: "pw", deviceId: A.deviceId } });
  check(reA.status === 200 && reA.data.playerId === A.playerId && reA.data.role === "player", "host rejoins mid-game as a player");
  check((await call(`/api/rooms/${code}/state`, { token: A.token })).status === 401, "old token is dead");
  if (reA.data.token) A.token = reA.data.token;
  s = await state(code, A);
  check(s.game.mySeat === 0 && JSON.stringify(s.game.seats[0].sheet) === sheetBefore && s.room.hostPlayerId === A.playerId, "same seat, same sheet, still host");

  console.log("Spectator");
  const D = { ...(await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw" } })).data, name: "Dan" };
  check(D.role === "observer", "joining mid-game = spectator");
  const ds = await state(code, D);
  check(ds.game.mySeat === null && strip(ds.game) === strip((await state(code, A)).game), "spectator has no seat and sees the same game");
  check((await call(`/api/rooms/${code}/score`, { token: D.token, body: { category: "chance" } })).status === 403, "spectator score = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: D.token, body: { playerId: B.playerId } })).status === 403, "spectator kick = 403");
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
  const { CATEGORIES: cats } = await rules();
  const sums = s.game.seats.every((seat) => {
    const up = cats.slice(0, 6).reduce((a, k) => a + (seat.sheet[k] ?? 0), 0);
    const low = cats.slice(6).reduce((a, k) => a + (seat.sheet[k] ?? 0), 0);
    return seat.totals.total === up + (up >= 63 ? 35 : 0) + low + seat.yamsBonuses * 100;
  });
  check(sums, "totals = boxes + upper bonus + Yams bonuses");
  const ranked = s.game.standings.filter((x) => !x.left);
  check(ranked.every((x, i) => i === 0 || ranked[i - 1].total >= x.total), "winner has the highest total");
  check((await call(`/api/rooms/${code}/roll`, { token: A.token, body: { held: [false, false, false, false, false] } })).status === 409, "roll after the game = 409");

  console.log("New round");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: { queued: true } })).status === 409, "player queue = 409");
  const q = await call(`/api/rooms/${code}/queue`, { token: D.token, body: { queued: true } });
  check(q.status === 200 && q.data.queued === true && q.data.seated === false, "spectator queues for the next round");
  check((await state(code, A)).players.find((p) => p.id === D.playerId)?.queued === true, "players see the queue");
  check((await call(`/api/rooms/${code}/new-round`, { token: D.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = await state(code, D);
  check(s.room.status === "lobby" && s.room.round === 2 && s.me.role === "player" && s.players.every((p) => !p.ready), "spectator seated, ready reset");

  console.log("Cleanup");
  for (const p of [B, D]) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/yams_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
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
