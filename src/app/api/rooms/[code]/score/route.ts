import { isCategory, score, turnKey } from "@/lib/game";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/score  { turn, category } - writes the current dice in a free box and passes the turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/score">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "score", (game, { seat, body, now }) => {
    if (seat < 0) fail(403, "Ești spectator: joci de la următoarea partidă.");
    if (body.turn !== undefined && body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    if (!isCategory(body.category)) fail(400, "Căsuță invalidă.");
    return score(game, seat, body.category, now);
  });
}
