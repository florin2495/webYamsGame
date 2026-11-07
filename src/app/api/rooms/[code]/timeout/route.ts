import { forceTurn, TIMEOUT_GRACE_MS, turnDeadline, turnKey } from "@/lib/game";
import { secureRandom } from "@/lib/server/crypto";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/timeout  { turn } - the turn timer ran out: any member's device may ask the server to play
// the turn (roll once if needed, then the free box worth the most). `turn` (see turnKey) makes a late or repeated
// request a no-op instead of playing the next player's turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/timeout">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "timeout", (game, { body, now }) => {
    if (body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    const deadline = turnDeadline(game);
    if (deadline === null || now < deadline + TIMEOUT_GRACE_MS) fail(409, "Timpul nu a expirat încă.");
    return forceTurn(game, now, secureRandom);
  });
}
