// Scenario 3 (phone only): no screen may scroll sideways (home, lobby, game), the dice and the score boxes must stay
// big enough to tap (WCAG 2.2 minimum target: 24 x 24 CSS px), and real touch taps must roll, hold a die and write a
// box, seen live on the other phone. Scenario 1 already plays a full game on the emulated iPhone.
import { expect, test } from "@playwright/test";
import { createRoom, expectNoHorizontalScroll, joinRoom, leaveAll, readyAndStart, REALTIME_MS, withPlayers } from "./helpers";

const MIN_TAP_PX = 24;

test("home, lobby and game fit a phone screen and are tappable", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby fits the screen", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("ready")).toBeVisible();
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    await test.step("game screen fits", async () => {
      await readyAndStart(players, room.code);
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    await test.step("taps roll, hold a die and write a box; the other phone sees it live", async () => {
      const page = host.page;
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/roll`) && r.ok()),
        page.getByTestId("roll").tap(), // a touch tap, not a mouse click
      ]);
      const dice = page.getByTestId("die");
      await expect(dice).toHaveCount(5);
      const boxes = page.getByTestId("score-box");
      await expect(boxes.first()).toBeVisible();
      const minSide = (els: Element[]) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height));
      expect(Math.min(...(await dice.evaluateAll(minSide))), "smallest die").toBeGreaterThanOrEqual(MIN_TAP_PX);
      expect(Math.min(...(await boxes.evaluateAll(minSide))), "smallest score box").toBeGreaterThanOrEqual(MIN_TAP_PX);

      await dice.first().tap();
      await expect(dice.first()).toHaveAttribute("aria-pressed", "true");
      const rolled = (await page.getByTestId("dice").getAttribute("data-roll"))!;
      await expect(guest.page.getByTestId("dice")).toHaveAttribute("data-roll", rolled, { timeout: REALTIME_MS });
      await expectNoHorizontalScroll(page);

      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/score`) && r.ok()),
        boxes.first().tap(),
      ]);
      await expect(guest.page.getByTestId("turn-badge")).toHaveText(/E rândul tău/, { timeout: REALTIME_MS });
      await expectNoHorizontalScroll(guest.page);
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
