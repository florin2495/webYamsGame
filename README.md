# webYamsGame

Clasicul **Yams** cu 5 zaruri, între prieteni, pe telefon: până la **16 jucători** pe cameră (plus spectatori).
Pe stilul celorlalte jocuri din [haiLaTăt.icu](https://hailatat.icu): Next.js 16 (App Router), Supabase (Postgres +
Realtime Broadcast), deploy pe Vercel (fra1). Adresă: **https://games.hailatat.icu/yams**

## Reguli

1. Se joacă pe rând: host-ul primul, apoi în ordinea intrării. Fiecare are 13 ture (o căsuță pe tură).
2. La tura ta arunci 5 zaruri de cel mult 3 ori; între aruncări păstrezi zarurile pe care le vrei.
3. După orice aruncare alegi o căsuță liberă (o singură coloană, în orice ordine). Dacă zarurile nu fac figura: 0.
4. Sus: Unu … Șase = suma zarurilor cu acea valoare; **bonus +35** la cel puțin 63.
5. Jos: Brelan și Careu = suma tuturor zarurilor, Full 25, Chintă mică 30, Chintă mare 40, Yams 50, Șansă = suma.
6. Fiecare Yams în plus, după un Yams scris cu 50, dă **+100**.
7. Timp pe tură 20–60 s (ales de host). La expirare: o aruncare automată (dacă n-ai aruncat) și cea mai bună căsuță.
8. Cine intră în timpul partidei e spectator și joacă de la runda următoare.

## Dezvoltare

```bash
npm install
npm run dev -- -p 3011
npm test && npx tsc --noEmit && npx eslint src && npx next build
node scripts/e2e.mjs http://localhost:3011
```

Variabilele de mediu sunt în `.env.example` (`.env.local` nu se comite niciodată). Schema bazei de date:
`supabase/schema.sql` (rulată de mână în Supabase SQL editor).
