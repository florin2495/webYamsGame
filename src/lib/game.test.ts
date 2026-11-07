import { describe, expect, it } from "vitest";
import {
  bestCategory,
  CATEGORIES,
  type Category,
  DEFAULT_SETTINGS,
  forceTurn,
  type GameState,
  isRoomExpired,
  newGame,
  removeSeat,
  roll,
  RuleError,
  score,
  scoreFor,
  seatOrder,
  settingsError,
  standings,
  totals,
  turnDeadline,
} from "./game";

/** rng that yields the given faces (1-6) in order, then repeats the last one. */
function faces(...f: number[]) {
  let i = 0;
  return () => (f[Math.min(i++, f.length - 1)] - 1) / 6 + 0.01;
}

function game(n = 2, now = 1_000): GameState {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  return newGame(ids, ids.map((id) => id.toUpperCase()), DEFAULT_SETTINGS, now);
}

/** Puts these dice on the table for the player on turn (as after one roll). */
const withDice = (g: GameState, dice: number[]): GameState => ({ ...g, dice, rolls: 1 });

describe("scoreFor", () => {
  const cases: [Category, number[], number][] = [
    ["ones", [1, 1, 2, 3, 1], 3],
    ["sixes", [6, 6, 6, 6, 2], 24],
    ["threes", [1, 2, 4, 5, 6], 0],
    ["brelan", [3, 3, 3, 1, 2], 12],
    ["brelan", [5, 5, 5, 5, 2], 22],
    ["brelan", [1, 1, 2, 2, 3], 0],
    ["carre", [4, 4, 4, 4, 1], 17],
    ["carre", [6, 6, 6, 6, 6], 30],
    ["carre", [4, 4, 4, 1, 1], 0],
    ["full", [2, 2, 3, 3, 3], 25],
    ["full", [2, 2, 2, 2, 2], 0],
    ["full", [2, 2, 3, 3, 4], 0],
    ["smallStraight", [1, 2, 3, 4, 6], 30],
    ["smallStraight", [3, 4, 5, 6, 6], 30],
    ["smallStraight", [2, 3, 4, 5, 6], 30],
    ["smallStraight", [1, 2, 3, 5, 6], 0],
    ["largeStraight", [5, 4, 3, 2, 1], 40],
    ["largeStraight", [2, 3, 4, 5, 6], 40],
    ["largeStraight", [1, 2, 3, 4, 6], 0],
    ["yams", [4, 4, 4, 4, 4], 50],
    ["yams", [4, 4, 4, 4, 3], 0],
    ["chance", [1, 2, 3, 4, 6], 16],
  ];
  it.each(cases)("%s %j = %i", (cat, dice, pts) => expect(scoreFor(cat, dice)).toBe(pts));
});

describe("totals", () => {
  it("adds the upper bonus at 63 or more", () => {
    const sheet = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(totals(sheet)).toMatchObject({ upper: 63, bonus: 35, total: 98 });
    expect(totals({ ...sheet, sixes: 12 })).toMatchObject({ upper: 57, bonus: 0, total: 57 });
  });
  it("counts the lower section and Yams bonuses", () => {
    expect(totals({ full: 25, yams: 50, chance: 20 }, 2)).toMatchObject({ lower: 95, yamsBonus: 200, total: 295 });
  });
});

describe("bestCategory", () => {
  it("picks the free box worth the most, first one on ties", () => {
    expect(bestCategory({}, [6, 6, 6, 6, 6])).toBe("yams");
    expect(bestCategory({ yams: 50 }, [6, 6, 6, 6, 6])).toBe("sixes"); // sixes 30 = brelan 30 = carre 30 = chance: first wins
    expect(bestCategory({}, [1, 2, 3, 4, 6])).toBe("smallStraight");
    expect(bestCategory({}, [1, 1, 2, 3, 5])).toBe("chance");
  });
  it("returns a box worth 0 when nothing scores", () => {
    const all = Object.fromEntries(CATEGORIES.filter((c) => c !== "yams").map((c) => [c, 0]));
    expect(bestCategory(all, [1, 2, 3, 4, 6])).toBe("yams");
  });
});

describe("turns", () => {
  it("seats the host first, then join order", () => {
    expect(seatOrder(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("rolls up to 3 times, keeping held dice", () => {
    let g = game();
    g = roll(g, 0, [true, true, true, true, true], faces(1, 2, 3, 4, 5)); // holds ignored on the first roll
    expect(g.dice).toEqual([1, 2, 3, 4, 5]);
    g = roll(g, 0, [true, false, true, false, false], faces(6, 6, 6));
    expect(g.dice).toEqual([1, 6, 3, 6, 6]);
    expect(g.held).toEqual([true, false, true, false, false]);
    g = roll(g, 0, [false, true, false, true, true], faces(6, 6));
    expect(g.dice).toEqual([6, 6, 6, 6, 6]);
    expect(() => roll(g, 0, [], faces(1))).toThrow(RuleError);
  });

  it("rejects out-of-turn moves, scoring before rolling and holding all five", () => {
    const g = game();
    expect(() => roll(g, 1, [], faces(1))).toThrow("Nu e rândul tău.");
    expect(() => score(g, 0, "chance", 2_000)).toThrow("Aruncă zarurile mai întâi.");
    const rolled = roll(g, 0, [], faces(1, 2, 3, 4, 5));
    expect(() => roll(rolled, 0, [true, true, true, true, true], faces(1))).toThrow(RuleError);
  });

  it("scores, passes the turn and resets the dice", () => {
    const g = score(withDice(game(3), [2, 2, 3, 3, 3]), 0, "full", 5_000);
    expect(g.sheets[0]).toEqual({ full: 25 });
    expect(g.turn).toBe(1);
    expect(g.rolls).toBe(0);
    expect(g.dice).toEqual([0, 0, 0, 0, 0]);
    expect(g.turnNo).toBe(2);
    expect(g.turnStartedAt).toBe(5_000);
    expect(turnDeadline(g)).toBe(5_000 + DEFAULT_SETTINGS.turnSeconds * 1000);
    expect(g.last).toMatchObject({ seat: 0, category: "full", points: 25, yamsBonus: false, auto: false });
    expect(() => score(withDice({ ...g, turn: 0 }, [1, 1, 1, 1, 1]), 0, "full", 6_000)).toThrow("Căsuța e deja completată.");
  });

  it("gives +100 for a Yams after a Yams scored 50, not after a crossed-out Yams", () => {
    let g = game(1 + 1);
    g = { ...g, sheets: [{ yams: 50 }, { yams: 0 }] };
    g = score(withDice(g, [3, 3, 3, 3, 3]), 0, "threes", 0);
    expect(g.yamsBonuses).toEqual([1, 0]);
    expect(g.last?.yamsBonus).toBe(true);
    g = score(withDice(g, [3, 3, 3, 3, 3]), 1, "threes", 0);
    expect(g.yamsBonuses).toEqual([1, 0]);
  });

  it("timeout: rolls once if needed, then takes the best free box", () => {
    const g = forceTurn(game(), 9_000, faces(5, 5, 5, 5, 5));
    expect(g.sheets[0]).toEqual({ yams: 50 });
    expect(g.last).toMatchObject({ auto: true, category: "yams" });
    expect(g.timeouts).toEqual([1, 0]);
    // already rolled: keeps the dice on the table
    const h = forceTurn(withDice(g, [1, 2, 3, 4, 5]), 10_000, faces(6));
    expect(h.sheets[1]).toEqual({ largeStraight: 40 });
  });

  it("a manual move resets the timeout streak", () => {
    let g = forceTurn(game(), 0, faces(1));
    g = forceTurn(g, 0, faces(1));
    g = score(withDice(g, [1, 2, 3, 4, 5]), 0, "chance", 0);
    expect(g.timeouts).toEqual([0, 1]);
  });

  it("removing the player on turn passes the turn; last one out ends the game", () => {
    let g = roll(game(3), 0, [], faces(1));
    g = removeSeat(g, 0, 7_000);
    expect(g.turn).toBe(1);
    expect(g.rolls).toBe(0);
    g = removeSeat(g, 2, 7_000);
    expect(g.turn).toBe(1);
    g = score(withDice(g, [1, 1, 1, 1, 1]), 1, "ones", 8_000);
    expect(g.turn).toBe(1); // alone now: plays every turn
    g = removeSeat(g, 1, 9_000);
    expect(g.phase).toBe("over");
  });
});

describe("full games", () => {
  it.each([2, 5, 16])("%i players fill 13 boxes each, then the game ends", (n) => {
    let g = game(n);
    let seed = n * 7919;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let turns = 0;
    while (g.phase === "playing") {
      if (turns % 3 === 0) g = forceTurn(g, turns, rng);
      else {
        g = roll(g, g.turn, [], rng);
        g = roll(g, g.turn, [true, false, true, false, false], rng);
        g = score(g, g.turn, bestCategory(g.sheets[g.turn], g.dice)!, turns);
      }
      turns++;
      expect(turns).toBeLessThanOrEqual(13 * n);
    }
    expect(turns).toBe(13 * n);
    for (const s of g.sheets) expect(Object.keys(s)).toHaveLength(13);
    const st = standings(g);
    expect(st[0].place).toBe(1);
    for (let i = 1; i < st.length; i++) expect(st[i].total).toBeLessThanOrEqual(st[i - 1].total);
  });

  it("standings share places on ties and leave out players who left", () => {
    const g = { ...game(4), sheets: [{ chance: 20 }, { chance: 30 }, { chance: 20 }, { chance: 99 }], left: [false, false, false, true] };
    expect(standings(g).map((r) => [r.seat, r.place])).toEqual([
      [1, 1],
      [0, 2],
      [2, 2],
      [3, null],
    ]);
  });
});

describe("settings and rooms", () => {
  it("accepts 20-60 s in steps of 5", () => {
    expect(settingsError({ turnSeconds: 20 })).toBeNull();
    expect(settingsError({ turnSeconds: 60 })).toBeNull();
    expect(settingsError({ turnSeconds: 15 })).not.toBeNull();
    expect(settingsError({ turnSeconds: 33 })).not.toBeNull();
  });
  it("expires idle rooms", () => {
    const t = new Date(0);
    expect(isRoomExpired("lobby", t, 2 * 60_000 + 1)).toBe(true);
    expect(isRoomExpired("lobby", t, 60_000)).toBe(false);
    expect(isRoomExpired("playing", t, 30 * 60_000)).toBe(false);
  });
});
