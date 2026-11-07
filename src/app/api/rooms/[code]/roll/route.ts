import { roll, turnKey } from "@/lib/game";
import { secureRandom } from "@/lib/server/crypto";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/roll  { turn, held: boolean[5] } - rolls the dice not held (all five on the first roll).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/roll">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "roll", (game, { seat, body }) => {
    if (seat < 0) fail(403, "Ești spectator: joci de la următoarea partidă.");
    if (body.turn !== undefined && body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    const held = body.held;
    if (held !== undefined && !(Array.isArray(held) && held.length === 5 && held.every((h) => typeof h === "boolean"))) {
      fail(400, "Zaruri păstrate invalide.");
    }
    return roll(game, seat, (held as boolean[] | undefined) ?? [], secureRandom);
  });
}
