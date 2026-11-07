import { TURN_OPTIONS, UPPER_BONUS, UPPER_BONUS_AT, YAMS_BONUS } from "@/lib/game";

/** Short rules, collapsed by default. */
export function Rules() {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Se joacă pe rând: host-ul primul, apoi în ordinea intrării. O partidă are 13 ture pentru fiecare jucător.</li>
        <li>La tura ta arunci 5 zaruri de cel mult 3 ori. Între aruncări atingi zarurile pe care vrei să le păstrezi.</li>
        <li>După orice aruncare alegi o căsuță liberă din foaie. Dacă zarurile nu fac figura, căsuța se taie cu 0.</li>
        <li>
          Sus: Unu … Șase = suma zarurilor cu acea valoare. Bonus +{UPPER_BONUS} dacă ai cel puțin {UPPER_BONUS_AT} sus.
        </li>
        <li>
          Jos: Brelan (3 la fel) și Careu (4 la fel) = suma tuturor zarurilor, Full (3 + 2) = 25, Chintă mică (4 la rând) = 30,
          Chintă mare (5 la rând) = 40, Yams (5 la fel) = 50, Șansă = suma zarurilor.
        </li>
        <li>Fiecare Yams în plus, după ce ai scris deja 50 la Yams, dă +{YAMS_BONUS}. Zarurile le treci normal la o altă căsuță.</li>
        <li>
          Fiecare tură are între {TURN_OPTIONS[0]} și {TURN_OPTIONS[TURN_OPTIONS.length - 1]} de secunde (alege host-ul). Dacă timpul
          expiră, se aruncă o dată (dacă n-ai aruncat) și se scrie automat la căsuța cu cele mai multe puncte.
        </li>
        <li>Cine intră în timpul unei partide o urmărește ca spectator și joacă de la următoarea.</li>
        <li>Câștigă cine are cel mai mare total după 13 ture.</li>
      </ol>
    </details>
  );
}
