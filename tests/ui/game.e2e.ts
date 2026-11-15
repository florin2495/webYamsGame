// Scenario 1: two real browsers play a full live Yams game on the deployed site: create, join by link, ready, start,
// 13 rounds each (roll, then the best box on screen), every roll and every turn change reaching the other player
// through Realtime (well under the 60 s polling fallback), the results on both screens, a new round followed live,
// leave. Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, readyAndStart, REALTIME_MS, withPlayers } from "./helpers";

test("two players play a full live game to the results", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("ready")).toBeVisible();
      await expect(host.page.getByTestId("player-list")).toContainText(guest.name, { timeout: REALTIME_MS });
    });

    await test.step("guest gets ready, host starts", () => readyAndStart(players, room.code));

    await test.step("13 rounds each, every roll and turn live on the other screen", () =>
      playTurns([host, guest], 13 * players.length, room.code, [], true),
    );

    await test.step("both see the same results", async () => {
      const heading = host.page.getByTestId("results").getByRole("heading");
      await expect(heading).toHaveText(/A câștigat (Ana|Bob)!|Egalitate: Ana, Bob/);
      const text = (await heading.textContent())!;
      await expect(guest.page.getByTestId("results").getByRole("heading")).toHaveText(text, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("roll")).toHaveCount(0);
    });

    await test.step("host starts a new round, the guest follows live", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(host.page.getByTestId("start-game")).toBeVisible();
      await expect(guest.page.getByTestId("ready")).toContainText("Sunt ready", { timeout: REALTIME_MS });
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
