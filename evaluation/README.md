# Vragen beoordelen

`questions.nl.json` bevat 72 vragen: zes uit de aangeleverde demo's, de overige vragen zijn realistische, nieuw geschreven evaluatievragen. Dit zijn geen 72 verzamelde gebruikersuitspraken. `gesproken-transcript` test tekst ná spraakherkenning, geen audio of microfoon. Spraakverwarring staat onder andere in `kongres` en `kiev`.

`context.nl.json` beschrijft vier **synthetische** broncontexten, zonder actueel nieuws te claimen. De verwachting geldt alleen bij deze context: geen Gaza-bericht, wel Oekraïne en Amerika. De zes historische fouten en het gewenste antwoord staan in het rapport. De vraag na Gaza heeft ook eerdere gesprekstekst.

## Zonder model of server

```sh
source ~/.nvm/nvm.sh
nvm use 26
npm test
npm run typecheck
node scripts/evaluate-questions.mjs --dry-run
```

De negen open fouten uit de review (TODO) zijn met de beslissing vooraf opgelost en staan nu als gewone tests in `tests/questions-review.test.ts`. De zes demo-tests met nepmodel controleren de codepaden, niet of een echt model de juiste JSON kiest.

## Tegen POST /api/explain

Een geschikte server biedt de vier contexten aan, met de juiste regio, broninhoud en beschikbaarheid. Dat doet `NEWS_MODE=eval`: de vier berichten uit `context.nl.json`, allemaal van het afgelopen uur. Start die naast de gewone server, met een eigen bouwmap en zonder Anam of testlog:

```sh
NEXT_DIST_DIR=.next-eval NEWS_MODE=eval AVATAR_MODE=simulated NOVA_TEST_LOG=0 npx next dev -p 3001
```

De id's zijn dan gewoon `haarlem`, `stikstof`, `amerika` en `oekraine`. Bij een live feed moet een beoordelaar vooraf de context en verwachtingen aanpassen en vastleggen. Alleen id's vervangen maakt de evaluatie niet geldig.

Maak na die controle een bindingsbestand, bijvoorbeeld buiten de repo:

```json
{"haarlem":"server-id-haarlem","stikstof":"server-id-stikstof","amerika":"server-id-amerika","oekraine":"server-id-oekraine"}
```

```sh
NOVA_EVAL_BINDINGS=/private/tmp/nova-bindings.json \
NOVA_EVAL_URL=http://localhost:3000 \
node scripts/evaluate-questions.mjs --review
```

Het script controleert dat alle vier id's bestaan, vraagt alleen `/api/news` en `/api/explain` op en start nooit een Anam-stream. Bij zelf starten: `AVATAR_MODE=simulated NOVA_TEST_LOG=0 npm run dev`. Wijzig `.env.local` niet; die staat hier op Anam.

Standaard wacht het script 90 seconden na ieder antwoord én na de eerste nieuwsaanvraag (die kan een kernantwoord voorbereiden). Dat vermindert quotumdruk, maar garandeert geen vrije capaciteit bij andere gebruikers of een enkele heel grote vraag. Bij HTTP 429: fout meetellen, geen automatische herhaling die de meting verandert. Stel desgewenst `NOVA_EVAL_INTERVAL_MS` hoger in (minimum 60000). `NOVA_EVAL_LIMIT=6` geeft een rooktest van de eerste zes cases, niet van de zes demo's. Een volledige run duurt minstens circa 108 minuten, plus generatietijd.

Zonder `--review` bevat uitvoer uitsluitend case-id, resultaat, request-id en modelpogingen; het script schrijft geen bestanden. Structuur betekent: juist artikel, juiste wissel, overzichtvlag, aankondiging of geen-nieuwszin. Dit bewijst geen feitelijke juistheid, regio, tijdvak of A2. Met `--review` verschijnt antwoordtekst tijdelijk in de terminal en scoort een beoordelaar inhoud met de rubric. Redirect die interactieve uitvoer niet naar `logs/`. De samenvatting telt per categorie structuur, inhoud goed/fout en onbeoordeeld apart. Beoordeel ook wie een uitspraak doet, onzekerheden en verzonnen details; een juiste route met onjuiste inhoud is onvoldoende.

De runner controleert de aanwezigheid van id's bij aanvang. Verdwijnen artikelen tijdens de run uit de feed, dan telt een 404 als fout; label deze run als feedinstabiel en vergelijk hem niet als vaste modelbenchmark.
