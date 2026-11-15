// Yams rules: pure functions, shared by server (authoritative) and client (display only).
// One score column, 13 boxes filled in any order, 3 rolls per turn, players take turns (host first).

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const MAX_OBSERVERS = 16;
export const NICKNAME_MAX = 12;
/** Lobby/finished rooms nobody has open are closed after this long. */
export const ROOM_IDLE_MINUTES = 10;
/** A running game nobody has open is closed after this long. */
export const PLAYING_IDLE_MINUTES = 60;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;
/** Extra time on top of the turn timer, for network latency, before a turn can be forced. */
export const TIMEOUT_GRACE_MS = 1_500;

export const DICE = 5;
export const ROLLS_PER_TURN = 3;
export const UPPER_BONUS_AT = 63;
export const UPPER_BONUS = 35;
/** Every Yams after a Yams already scored 50. */
export const YAMS_BONUS = 100;
/** Points of the Yams box. */
const YAMS_POINTS = 50;

export const TURN_OPTIONS = [20, 25, 30, 35, 40, 45, 50, 55, 60];

export interface Settings {
  /** Seconds per turn (all three rolls and the choice of a box). */
  turnSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = { turnSeconds: 30 };

/** Problem with these settings, in Romanian, or null when valid. */
export function settingsError(s: Settings): string | null {
  if (!TURN_OPTIONS.includes(s.turnSeconds)) return "Timpul pe tură trebuie să fie între 20 și 60 de secunde (din 5 în 5).";
  return null;
}

/** "2 minute" / "60 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  if (status === "playing") return idle > PLAYING_IDLE_MINUTES * 60_000;
  return idle > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * player or spectator has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

// ---------------------------------------------------------------------------
// Score sheet
// ---------------------------------------------------------------------------

export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
export const LOWER = ["brelan", "carre", "full", "smallStraight", "largeStraight", "yams", "chance"] as const;
export const CATEGORIES = [...UPPER, ...LOWER] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  ones: "Unu",
  twos: "Doi",
  threes: "Trei",
  fours: "Patru",
  fives: "Cinci",
  sixes: "Șase",
  brelan: "Brelan",
  carre: "Careu",
  full: "Full",
  smallStraight: "Chintă mică",
  largeStraight: "Chintă mare",
  yams: "Yams",
  chance: "Șansă",
};

export const CATEGORY_HINT: Record<Category, string> = {
  ones: "suma zarurilor de 1",
  twos: "suma zarurilor de 2",
  threes: "suma zarurilor de 3",
  fours: "suma zarurilor de 4",
  fives: "suma zarurilor de 5",
  sixes: "suma zarurilor de 6",
  brelan: "3 la fel · suma zarurilor",
  carre: "4 la fel · suma zarurilor",
  full: "3 + 2 la fel · 25",
  smallStraight: "4 la rând · 30",
  largeStraight: "5 la rând · 40",
  yams: "5 la fel · 50",
  chance: "orice · suma zarurilor",
};

export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

/** Filled boxes of one player. A missing key = box still free (0 is a valid, crossed-out score). */
export type Sheet = Partial<Record<Category, number>>;

function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

const sum = (dice: number[]) => dice.reduce((a, b) => a + b, 0);

function hasRun(c: number[], length: number): boolean {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] > 0 ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

export const isYams = (dice: number[]) => dice.length === DICE && dice.every((d) => d >= 1 && d === dice[0]);

/** Points the dice are worth in a box (0 when they do not make the figure). */
export function scoreFor(category: Category, dice: number[]): number {
  const c = counts(dice);
  const max = Math.max(...c);
  switch (category) {
    case "ones":
    case "twos":
    case "threes":
    case "fours":
    case "fives":
    case "sixes": {
      const v = UPPER.indexOf(category) + 1;
      return v * c[v];
    }
    case "brelan":
      return max >= 3 ? sum(dice) : 0;
    case "carre":
      return max >= 4 ? sum(dice) : 0;
    case "full":
      return c.includes(3) && c.includes(2) ? 25 : 0;
    case "smallStraight":
      return hasRun(c, 4) ? 30 : 0;
    case "largeStraight":
      return hasRun(c, 5) ? 40 : 0;
    case "yams":
      return max === 5 ? YAMS_POINTS : 0;
    case "chance":
      return sum(dice);
  }
}

export interface Totals {
  upper: number;
  bonus: number;
  lower: number;
  yamsBonus: number;
  total: number;
}

export function totals(sheet: Sheet, yamsBonuses = 0): Totals {
  const upper = UPPER.reduce((a, k) => a + (sheet[k] ?? 0), 0);
  const lower = LOWER.reduce((a, k) => a + (sheet[k] ?? 0), 0);
  const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
  const yamsBonus = yamsBonuses * YAMS_BONUS;
  return { upper, bonus, lower, yamsBonus, total: upper + bonus + lower + yamsBonus };
}

export const freeBoxes = (sheet: Sheet) => CATEGORIES.filter((k) => sheet[k] === undefined);

/** Free box worth the most with these dice; ties go to the first one in sheet order. */
export function bestCategory(sheet: Sheet, dice: number[]): Category | null {
  let best: Category | null = null;
  let bestPts = -1;
  for (const k of freeBoxes(sheet)) {
    const pts = scoreFor(k, dice);
    if (pts > bestPts) {
      best = k;
      bestPts = pts;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export class RuleError extends Error {}

export interface LastMove {
  seat: number;
  category: Category;
  points: number;
  dice: number[];
  /** A Yams bonus (+100) came with this move. */
  yamsBonus: boolean;
  /** Played by the server because the timer ran out. */
  auto: boolean;
}

export interface GameState {
  /** Player ids in turn order (host first, then join order). */
  seats: string[];
  names: string[];
  sheets: Sheet[];
  /** Yams bonuses (+100 each) won by each seat. */
  yamsBonuses: number[];
  /** Left or was kicked: skipped, not ranked. */
  left: boolean[];
  turn: number;
  /** Current dice, 0 = not rolled yet this turn. */
  dice: number[];
  /** Dice kept on the last roll (shown to everyone). */
  held: boolean[];
  /** Rolls used this turn, 0..ROLLS_PER_TURN. */
  rolls: number;
  /** Increments on every turn; identifies the turn in /timeout. */
  turnNo: number;
  turnStartedAt: number;
  turnSeconds: number;
  phase: "playing" | "over";
  last: LastMove | null;
  /** Consecutive timeouts per seat (shown, not acted on). */
  timeouts: number[];
}

/** Host first, then everyone else in join order. */
export function seatOrder(ids: string[], hostId: string | null): string[] {
  const host = ids.filter((id) => id === hostId);
  return [...host, ...ids.filter((id) => id !== hostId)];
}

const emptyDice = () => Array<number>(DICE).fill(0);
const noHolds = () => Array<boolean>(DICE).fill(false);

export function newGame(seats: string[], names: string[], settings: Settings, now: number): GameState {
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) throw new RuleError(`Ai nevoie de ${MIN_PLAYERS}-${MAX_PLAYERS} jucători.`);
  return {
    seats: [...seats],
    names: [...names],
    sheets: seats.map(() => ({})),
    yamsBonuses: seats.map(() => 0),
    left: seats.map(() => false),
    turn: 0,
    dice: emptyDice(),
    held: noHolds(),
    rolls: 0,
    turnNo: 1,
    turnStartedAt: now,
    turnSeconds: settings.turnSeconds,
    phase: "playing",
    last: null,
    timeouts: seats.map(() => 0),
  };
}

export const turnKey = (g: Pick<GameState, "turnNo">) => String(g.turnNo);
export const turnDeadline = (g: GameState) => (g.phase === "playing" ? g.turnStartedAt + g.turnSeconds * 1000 : null);
/** Turn number in the 13-box game (1..13) of the player on turn. */
export const roundOf = (g: GameState) => Math.min(CATEGORIES.length, CATEGORIES.length - freeBoxes(g.sheets[g.turn]).length + 1);

const active = (g: GameState, i: number) => !g.left[i] && freeBoxes(g.sheets[i]).length > 0;

/** Next turn: the next seat (cyclic) still in and with a free box; the game ends when there is none. */
function advance(g: GameState, now: number): GameState {
  const n = g.seats.length;
  let next = -1;
  for (let step = 1; step <= n; step++) {
    const i = (g.turn + step) % n;
    if (active(g, i)) {
      next = i;
      break;
    }
  }
  const base = { ...g, dice: emptyDice(), held: noHolds(), rolls: 0, turnNo: g.turnNo + 1, turnStartedAt: now };
  if (next < 0) return { ...base, phase: "over" };
  return { ...base, turn: next };
}

function requireTurn(g: GameState, seat: number) {
  if (g.phase !== "playing") throw new RuleError("Partida s-a terminat.");
  if (seat < 0) throw new RuleError("Nu joci în această partidă.");
  if (g.turn !== seat) throw new RuleError("Nu e rândul tău.");
}

/**
 * Rolls the dice not held. The first roll of a turn rolls all five (holds are ignored).
 * `rng` returns a uniform number in [0, 1).
 */
export function roll(g: GameState, seat: number, held: boolean[], rng: () => number): GameState {
  requireTurn(g, seat);
  if (g.rolls >= ROLLS_PER_TURN) throw new RuleError("Ai folosit toate cele 3 aruncări. Alege o căsuță.");
  const keep = g.rolls === 0 ? noHolds() : Array.from({ length: DICE }, (_, i) => held[i] === true);
  if (keep.every(Boolean)) throw new RuleError("Ai păstrat toate zarurile. Alege o căsuță sau eliberează un zar.");
  const dice = g.dice.map((d, i) => (keep[i] ? d : 1 + Math.floor(rng() * 6)));
  return { ...g, dice, held: keep, rolls: g.rolls + 1 };
}

/** Writes the current dice in a free box and passes the turn. */
export function score(g: GameState, seat: number, category: Category, now: number, auto = false): GameState {
  requireTurn(g, seat);
  if (g.rolls === 0) throw new RuleError("Aruncă zarurile mai întâi.");
  const sheet = g.sheets[seat];
  if (sheet[category] !== undefined) throw new RuleError("Căsuța e deja completată.");
  const points = scoreFor(category, g.dice);
  const yamsBonus = isYams(g.dice) && sheet.yams === YAMS_POINTS;
  const sheets = g.sheets.map((s, i) => (i === seat ? { ...s, [category]: points } : s));
  const yamsBonuses = g.yamsBonuses.map((b, i) => (i === seat && yamsBonus ? b + 1 : b));
  const timeouts = g.timeouts.map((t, i) => (i === seat ? (auto ? t + 1 : 0) : t));
  const last: LastMove = { seat, category, points, dice: [...g.dice], yamsBonus, auto };
  return advance({ ...g, sheets, yamsBonuses, timeouts, last }, now);
}


/**
 * The timer ran out: rolls once if the player has not rolled yet, then writes the dice in the free box
 * worth the most (ties: first in sheet order).
 */
export function forceTurn(g: GameState, now: number, rng: () => number): GameState {
  if (g.phase !== "playing") throw new RuleError("Partida s-a terminat.");
  const seat = g.turn;
  const rolled = g.rolls === 0 ? roll(g, seat, noHolds(), rng) : g;
  const category = bestCategory(rolled.sheets[seat], rolled.dice);
  if (!category) return advance(rolled, now); // cannot happen: the seat on turn always has a free box
  return score(rolled, seat, category, now, true);
}

/** A player left or was kicked: out of the ranking; if it was their turn, the next player goes. */
export function removeSeat(g: GameState, seat: number, now: number): GameState {
  if (seat < 0 || g.left[seat]) return g;
  const left = g.left.map((l, i) => l || i === seat);
  const next = { ...g, left };
  if (g.phase !== "playing") return next;
  if (left.every(Boolean)) return { ...next, phase: "over" };
  return g.turn === seat ? advance(next, now) : next;
}

export interface Standing {
  seat: number;
  name: string;
  total: number;
  /** 1-based, ties share a place; null for players who left. */
  place: number | null;
  left: boolean;
}

/** Everyone sorted by total (players who left last). */
export function standings(g: GameState): Standing[] {
  const rows = g.seats.map((_, seat) => ({
    seat,
    name: g.names[seat],
    total: totals(g.sheets[seat], g.yamsBonuses[seat]).total,
    left: g.left[seat],
    place: null as number | null,
  }));
  rows.sort((a, b) => Number(a.left) - Number(b.left) || b.total - a.total || a.seat - b.seat);
  let place = 0;
  rows.forEach((r, i) => {
    if (r.left) return;
    if (i === 0 || r.total !== rows[i - 1].total) place = i + 1;
    r.place = place;
  });
  return rows;
}
