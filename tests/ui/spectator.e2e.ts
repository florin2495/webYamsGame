// Scenario 2: someone opens the invite link of a running game. They become a spectator (no dice to roll, no boxes
// to pick), see every roll and turn live, queue for the next round, see a player leave mid-game and the host finish
// alone, see the results, and the host's "Rundă nouă" seats them. Desktop Chromium only: it checks game logic and
// Realtime, the device does not matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playTurns, readyAndStart, REALTIME_MS, withPlayers } from "./helpers";

test("a late joiner watches as a spectator and plays from the next round", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;

    await test.step("two players start a game", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await readyAndStart([host, guest], room.code);
    });

    await test.step("a third person joins mid-game and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      const sp = spectator.page;
      await expect(sp.getByTestId("spectator-status")).toBeVisible();
      await expect(sp.getByTestId("turn-badge")).toHaveText(`Rândul lui ${host.name}`);
      for (const id of ["roll", "score-box", "die", "ready", "start-game"]) await expect(sp.getByTestId(id)).toHaveCount(0);
    });

    await test.step("the spectator queues for the next round", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toContainText("Ești în coadă");
    });

    await test.step("one round is played; the spectator sees every roll and turn live", () =>
      playTurns([host, guest], 2, room.code, [spectator]),
    );

    await test.step("the guest leaves mid-game, the host finishes alone, watched live", async () => {
      await leaveAll([guest]);
      await playTurns([host], 12, room.code, [spectator], true);
    });

    await test.step("the spectator sees the results", async () => {
      const results = spectator.page.getByTestId("results");
      await expect(results).toContainText(`A câștigat ${host.name}!`, { timeout: REALTIME_MS });
      await expect(results).toContainText("a plecat");
    });

    await test.step("new round: the queued spectator becomes a player", async () => {
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("ready")).toBeVisible({ timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("queue-toggle")).toHaveCount(0);
      await expect(host.page.getByTestId("player-list")).toContainText(spectator.name);
      await expect(host.page.getByTestId("spectator-list")).toHaveCount(0);
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, host]);
      room.closed = true;
    });
  });
});
