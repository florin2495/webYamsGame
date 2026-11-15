// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// Dice are random: every move is picked from what the screen shows (the "Scrie N la …" boxes), never hard-coded.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 60 s. */
export const REALTIME_MS = 5_000;

/** Longest turn timer: the tests never get close to it, so no turn is played automatically. */
const TURN_SECONDS = "60";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  const page = await context.newPage();
  // Every confirm() is accepted: "Tai … cu 0 puncte?" and the leave warnings.
  page.on("dialog", (d) => void d.accept());
  return { name, context, page };
}

const apiOk = (page: Page, code: string, action: string) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/${action}`) && r.request().method() === "POST" && r.ok());

/** Host creates a room from the home page (no password, 60 s turns); returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Timp pe tură").selectOption(TURN_SECONDS);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("start-game")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (lands in the lobby or as a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
}

/** Every guest presses "Sunt ready" (the host sees it live), then the host (players[0]) starts. */
export async function readyAndStart(players: Player[], code: string): Promise<void> {
  const [host, ...guests] = players;
  for (const g of guests) {
    await Promise.all([apiOk(g.page, code, "ready"), g.page.getByTestId("ready").click()]);
    await expect(g.page.getByTestId("ready")).toContainText("Ești ready");
  }
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await expect(host.page.getByTestId("start-game")).toContainText(`Începe partida (${players.length} jucători)`);
  await host.page.getByTestId("start-game").click();
  await expect(host.page.getByTestId("turn-badge")).toHaveText(/E rândul tău/);
  for (const g of guests) {
    await expect(g.page.getByTestId("turn-badge")).toHaveText(`Rândul lui ${host.name}`, { timeout: REALTIME_MS });
  }
}

/**
 * One turn on `cur`'s screen: roll once, check the dice reach every `viewer` live, then write them in the free box
 * worth the most (a 0 box is confirmed). `tap` uses touch taps instead of mouse clicks.
 */
export async function playTurn(cur: Player, code: string, viewers: Player[], tap = false): Promise<void> {
  const page = cur.page;
  await expect(page.getByTestId("turn-badge")).toHaveText(/E rândul tău/, { timeout: REALTIME_MS });
  const roll = page.getByTestId("roll");
  await expect(roll).toBeEnabled();
  await Promise.all([apiOk(page, code, "roll"), tap ? roll.tap() : roll.click()]);

  const boxes = page.getByTestId("score-box");
  await expect(boxes.first()).toBeVisible();
  const rolled = (await page.getByTestId("dice").getAttribute("data-roll"))!;
  expect(rolled).toMatch(/\|1\|[1-6]{5}$/);
  for (const v of viewers) await expect(v.page.getByTestId("dice")).toHaveAttribute("data-roll", rolled, { timeout: REALTIME_MS });

  const points = await boxes.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-points"))));
  const best = boxes.nth(points.indexOf(Math.max(...points)));
  const category = (await best.getAttribute("data-category"))!;
  await Promise.all([apiOk(page, code, "score"), tap ? best.tap() : best.click()]);
  await expect(page.locator(`[data-testid="score-value"][data-category="${category}"]`)).toHaveText(String(Math.max(...points)));
}

/**
 * Plays `count` turns, `order` taking turns in seat order (order[0] first). After each turn the `watchers`
 * (spectators) must see whose turn it is, live. `endsGame`: the last turn ends the game.
 */
export async function playTurns(order: Player[], count: number, code: string, watchers: Player[] = [], endsGame = false): Promise<void> {
  for (let i = 0; i < count; i++) {
    const cur = order[i % order.length];
    await playTurn(cur, code, [...order.filter((p) => p !== cur), ...watchers]);
    if (endsGame && i === count - 1) break;
    const next = order[(i + 1) % order.length];
    for (const w of watchers) {
      await expect(w.page.getByTestId("turn-badge")).toHaveText(`Rândul lui ${next.name}`, { timeout: REALTIME_MS });
    }
  }
}

/** Leaves through the "Părăsește …" button (the confirm is accepted by newPlayer), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/yams_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
