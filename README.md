# Nova — digitale nieuwsverteller (prototype)

Webprototype voor de minor Digital Humans: een AI-presentator die nieuws uitlegt aan laaggeletterde jongvolwassenen van 18 tot en met 24 jaar. Doel van het prototype: testen of deze groep nieuws beter begrijpt. Na de uitleg moet iemand kunnen vertellen wat er is gebeurd, wie erbij betrokken zijn, waarom het belangrijk is en wat nog onzeker is.

De pagina opent direct op de presentator, met de titel van het eerste bericht, het label "AI-presentator" en één knop: **Start**. Pas daarna starten geluid, Gemini en (in de echte modus) de betaalde D-ID-stream. Nova vertelt kort de kern en stopt. Daarna kiest de gebruiker zelf: **Leg makkelijker uit**, **Wat betekent dit?**, **Vertel meer**, **Nog een keer**, **Stel een vraag** of **Volgend bericht**, plus **Pauze/Verder** en **Ondertiteling aan/uit**. Geen account.

Terug naar de versie van vóór dit prototype (LiveAvatar + browserstem): `git checkout voor-did-prototype`.

## Starten

```bash
npm install
cp .env.example .env.local     # vul GEMINI_API_KEY in (en voor D-ID: zie hieronder)
npm run dev                    # http://localhost:3000
```

Standaard draait de **ontwikkelmodus** (`AVATAR_MODE=simulated`): D-ID wordt niet aangeroepen, de antwoordtekst staat in beeld, en een gele balk meldt dat de avatar gesimuleerd is. Heeft de browser een Nederlandse stem, dan leest die voor.

### Echte D-ID-stream

1. Zet `DID_API_KEY` in `.env.local`.
2. Maak de agent aan (gratis, geen stream): `node --env-file=.env.local scripts/did-setup.mjs create`. Dit zet `DID_AGENT_ID`, `DID_CLIENT_KEY` en `DID_POSTER_URL` in `.env.local`. `... did-setup.mjs status` toont tegoed en agents.
3. Controleer in D-ID Studio (Agents → Nova (prototype) → … → Embed) dat `http://localhost:3000` bij de toegestane domeinen staat. De client key werkt alleen vanaf die domeinen.
4. Zet `AVATAR_MODE=did` en herstart `npm run dev`.

Terug naar de ontwikkelmodus: `AVATAR_MODE=simulated` (of de regel weghalen) en herstarten. Alle variabelen staan met uitleg in [.env.example](.env.example).

### Tests

```bash
npm test          # 39 tests, met nagemaakte D-ID-SDK: geen betaalde stream
npm run typecheck
```

## Structuur

```
data/test-articles.json        vaste testselectie: 3 NOS-berichten, brontekst + hulpnotities
lib/articles.ts                berichten per modus (test of live), artikelversie (hash)
lib/news.ts                    NOS-feed voor NEWS_MODE=live (15 min cache, terugval op demo)
lib/prompt.ts                  systeemprompt, PROMPT_VERSION, opdracht per knop
lib/ai.ts                      generateExplanation(): Gemini, of de terugval
lib/gemini.ts                  het enige bestand dat Gemini kent (REST, modellenlijst)
lib/fallback.ts                regelgebaseerde terugval: alleen zinnen uit de bron
lib/spoken.ts                  gesproken tekst schoonmaken, zinnen splitsen
lib/validate.ts                validatie van /api/explain
lib/did.ts                     D-ID server-side: stem, begrenzing, tegoed, verbruik
lib/testlog.ts                 logs/*.jsonl (metadata, geen gespreksinhoud)
app/api/news                   berichten (zonder brontekst), modi, posterbeeld
app/api/explain                uitleg bij één bericht en één knop
app/api/did/session            agent-id en client key, pas na Start; begrenzing
app/api/did/usage              verbruik melden en tonen
app/page.tsx                   state, bediening, panelen, ontwikkelpaneel
components/presenter/          gesimuleerde en D-ID-presentator achter één interface
scripts/did-setup.mjs          agent aanmaken, tegoed tonen (alleen gratis calls)
tests/                         node --test
```

## Hoe een antwoord ontstaat

1. De pagina vraagt `/api/news`: titels, bron, datum en versie van de berichten. Geen brontekst, geen Gemini, geen stream.
2. Na **Start** (of een knop) stuurt de pagina `articleId`, `action` (`core`, `simpler`, `meaning`, `more`, `question`), eventueel de vraag, en de laatste uitleg bij **dit** bericht naar `/api/explain`.
3. De server zoekt het bericht op in de eigen gegevens. Het model kiest niet welk bericht het is, en bron, datum en link komen nooit uit het model.
4. Gemini krijgt de systeemprompt, de brontekst, de hulpnotities en de opdracht voor die knop, en geeft `{"spoken": "..."}` terug. De server haalt markdown, URL's, emoji en regieaanwijzingen weg.
5. De pagina toont dezelfde tekst als ondertiteling en laat de presentator die uitspreken.

**Volgend bericht** stopt de lopende uitleg, breekt een lopende aanvraag af, wist de context van het vorige bericht en negeert een antwoord dat te laat binnenkomt. Snel dubbelklikken geeft één aanvraag. **Nog een keer** maakt geen nieuwe aanvraag.

### Inhoud vervangen

De testberichten staan in [data/test-articles.json](data/test-articles.json): id, korte titel, oorspronkelijke titel, uitgever, URL, publicatie- en updatedatum, ophaaldatum, brontekst, en hulpnotities (kernfeiten, voorwaarden, onzekerheden). Vervang of voeg toe met dezelfde velden. De artikelversie rekent de server zelf uit. Een test controleert dat elk getal in de hulpnotities ook in de brontekst staat. Met `NEWS_MODE=live` gebruikt Nova de actuele NOS-feed (zonder hulpnotities).

### Testlog

`logs/answers.jsonl` bewaart per antwoord: request-id, bericht, artikelversie, promptversie, knop, `ai` of `fallback`, model, aantal woorden en gemiddelde woorden per zin. Bewust niet: de vraag van de gebruiker of de tekst van het antwoord. `logs/did-usage.jsonl` bewaart het verbruik. Beide staan in `.gitignore`.

## D-ID: wat de integratie wel en niet kan

Gecontroleerd in oktober 2026, in docs.d-id.com en in de typen van `@d-id/client-sdk` (vastgezet op 3.0.6):

- **Route.** De oude Talks/Clips Streams heten bij D-ID "legacy"; nieuwe integraties gaan via de Agents SDK. We gebruiken de agent in **`ChatMode.DirectPlayback`**: alleen `speak()`, geen chat en geen LLM van D-ID. De tekst komt dus van onze Gemini-server. Dat werkt met Talks (V2)- en Clips (V3)-agents, niet met Expressive (V4).
- **Sleutels.** `DID_API_KEY` blijft op de server. De browser krijgt na Start alleen de agent-id en de client key, de door D-ID bedoelde beperkte sleutel. De analytics van de SDK (Mixpanel) staan uit.
- **Avatar.** Agent `v2_agt_pxhNLRTB`: een **Talks-agent (V2)** met een eigen afbeelding (jongeman met bril, grijze achtergrond). D-ID heeft het gezicht herkend (agentstatus `done`). Een andere agent: zet `DID_AGENT_ID`, `DID_CLIENT_KEY` en `DID_POSTER_URL` in `.env.local` (de waarden staan bij de agent in D-ID Studio, of maak er een met `did-setup.mjs create`). De eerder gemaakte Clips-agent `v2_agt_UCJHlUHn` ("Mary") bestaat nog als alternatief.
- **Stem.** `nl-NL-MaartenNeural` (Microsoft, via D-ID), passend bij het mannelijke gezicht, tempo 1. Wordt per `speak()` meegestuurd, dus de Engelse stem die bij de agent zelf staat wordt niet gebruikt. Instelbaar met `DID_VOICE_ID` en `DID_VOICE_RATE`. Emoties en gezichtsuitdrukkingen sturen we niet aan: `sentiment` werkt alleen bij Expressive.
- **Pauze.** D-ID kent geen pauze. Op een *fluent* stream stopt `interrupt()` het spreken echt, en **Verder** laat de rest opnieuw uitspreken, vanaf de zin waar het ongeveer was (geschat uit de verstreken tijd). Zonder fluent stream gaat alleen het geluid uit en loopt het fragment bij D-ID door tot het eind. Dat telt dan mee in het verbruik. Een Talks-agent heeft **geen** fluent stream: Pauze zet dan het geluid uit en toont de rustige idle-video in plaats van het pratende gezicht (zonder idle-video: stilstaand beeld). Bij Verder gaat het verder waar D-ID nu is, dus wat tijdens de pauze werd gezegd is gemist. Bij een vraag, een andere knop of Volgend bericht sluit de app de verbinding: dat stopt het oude fragment echt, en een nieuwe verbinding wordt gemaakt terwijl Gemini het antwoord schrijft. Zonder dat speelde D-ID het antwoord direct na het oude fragment af, zonder stopsignaal ertussen, en bleef het antwoord stil. Echt onderbreken kan alleen met een Clips-agent op een Pro-avatar (zoals `v2_agt_UCJHlUHn`, nog te bevestigen bij de eerste verbinding) of een Expressive-agent. Tussen fragmenten toont de app de idle-video van de agent.
- **Ondertiteling.** D-ID meldt alleen begin en eind van het spreken, geen timing per zin, en `speak()` gaf bij onze Talks-agent geen duur terug. Daarom meten we zelf. De browser meet het geluidsniveau van de stream en schuift de markering een zin op na een stilte van minstens 300 ms (de pauze die de stem na een zin houdt). Dat is gemeten, niet geschat, maar een lange pauze midden in een zin kan de markering te vroeg laten opschuiven, en een korte pauze na een zin te laat. Bij "Nog een keer" uit het geheugen worden de gemeten tijden opnieuw gebruikt. Lukt meten niet (geen geluidsspoor of geen Web Audio), dan blijft het vak **Meeleestekst** zonder markering. Een SSML-pauze (`<break>`) na elke zin zou het zinseinde duidelijker maken, maar D-ID las die code bij onze Talks-agent hardop voor ("break time is gelijk aan…"), ondanks `ssml: true`. Daarom staat dat standaard uit (`DID_SENTENCE_BREAKS=1` om opnieuw te proberen).
- **Nog een keer.** Een volledig gesproken fragment wordt in het geheugen van de browser opgenomen (MediaRecorder) en lokaal opnieuw afgespeeld, zonder nieuwe video bij D-ID. Het wordt nergens opgeslagen of verstuurd. Lukt opnemen niet, of staat `DID_LOCAL_REPLAY=0`, dan vraagt herhalen een nieuwe `speak()`.
- **Opruimen.** De verbinding sluit bij het verlaten van de pagina, bij een verborgen tabblad en na 2 minuten stilstand. Die timer loopt alleen als Nova klaar of gepauzeerd is, nooit tijdens genereren, verbinden of spreken. Een verbinding die nog wordt opgebouwd als er wordt afgesloten, wordt geannuleerd (SDK 3.0.6: `disconnect()` annuleert een lopende `connect()`), en komt hij toch klaar, dan gaat hij meteen dicht. De volgende knop verbindt opnieuw.
- **Stoppen vóór Nova begint.** Een verstuurde `speak()` die nog niet speelt, kan `interrupt()` niet stoppen. Bij een Talks-agent sluit de app dan de verbinding, anders zou het oude fragment alsnog klinken. Bij een fluent stream staat het geluid uit tot het oude fragment begint, dan volgt direct `interrupt()`, en pas na het einde daarvan gaat het nieuwe antwoord naar D-ID. Na elke wachtstap controleert de presentator of het fragment nog het nieuwste is.
- **Metingen (ontwikkelserver).** Per klik één regel `[timing]` in de serverlog: cachestatus (`ready`, `pending` of `miss`), duur en afloop van elke modelpoging, tekst binnen, verbinden (en welk streamtype), `speak()` verstuurd en geaccepteerd, eerste beeld en eerste geluid, en waarom een verbinding dicht ging. Alleen getallen, geen tekst. Een klik die nooit hoorbaar werd, staat erbij als vervangen.

### Kosten en verbruik

Het tegoed is ongeveer 20 minuten voor het hele prototype. Daarom:

- In de ontwikkelmodus wordt D-ID niet aangeroepen. De interface, de bronnen en de antwoordlogica zijn dan volledig te testen.
- De echte stream start alleen na **Start**.
- Per `speak()` registreert de app de videoduur die de D-ID-API teruggeeft (**gemeten** door D-ID). Bij het sluiten registreert ze hoe lang de verbinding openstond (**schatting** met de klok van de browser).
- `/api/did/session` start geen nieuwe sessie meer zodra de grootste van die twee boven `DID_BUDGET_SECONDS` uitkomt (standaard 1200).
- Het ontwikkelpaneel (in `npm run dev`) toont beide getallen en het tegoed volgens D-ID (`GET /credits`).
- Of D-ID de verbindingstijd of alleen de gesproken tijd factureert, staat niet in de documentatie. 20 minuten klok is dus niet gegarandeerd 20 minuten facturering.

## Taal en journalistiek

De regels staan in `SYSTEM` in [lib/prompt.ts](lib/prompt.ts), gegroepeerd als rol, taal, opbouw, gesprek, journalistieke zorgvuldigheid, presentatie, veiligheid en antwoordformaat. Verander je de inhoud, verhoog dan `PROMPT_VERSION`. De opdracht per knop staat in `TASKS`. De basisuitleg is 60 tot 90 woorden: een instelbaar startpunt (`NOVA_CORE_WORDS`), geen onderzoeksuitkomst.

Valt Gemini weg (geen sleutel, quotum, time-out), dan kiest de terugval in [lib/fallback.ts](lib/fallback.ts) zinnen uit de bron. Ze verzint niets, maar herschrijft ook niet. De interface meldt het dan: "De AI werkt nu niet".

## Onderbouwing van de belangrijkste keuzes

| Keuze | Bron |
| --- | --- |
| Uitleg pas als de gebruiker erom vraagt (Leg makkelijker uit, Wat betekent dit?, Vertel meer), zelf herhalen, zelf door naar het volgende bericht, geen vraag na elk antwoord | Interviews: vrijwillige verdieping, controle over herhaling (ontwerphypothese, nog te testen) |
| Verzonnen voorbeelden als voorbeeld aangekondigd, volwassen toon, geen complimenten of straattaal | Interviews: herkenbare voorbeelden, volwassen aanspreektoon; factsheet: "neem de lezer serieus" |
| A2, ongeveer 10 woorden per zin, actief, gewone woorden, steeds hetzelfde woord, geen beeldspraak, moeilijke woorden meteen uitgelegd, getallen in cijfers | Factsheet Eenvoudige taal (Stichting Lezen en Schrijven), vertaald naar spraak zonder zinnen mechanisch af te kappen |
| Belangrijkste eerst, één bericht tegelijk, drie berichten in de test | Factsheet: boodschap bovenaan, niet meer dan 3 onderwerpen |
| Verdana/Helvetica, 18–20 px, regelafstand 1,5, links uitgelijnd, elke zin op een eigen regel | Factsheet (Vorm), als webvertaling, niet als letterlijk voorschrift |
| Alleen feiten uit de bron, zeggen wat onzeker is, toeschrijven, voorstel/besluit/geldt benoemen, geen eigen mening, geen verzonnen wederhoor, bron en datum zichtbaar, "Bekijk bron" | NVJ-code: zorgvuldig, onafhankelijk, bronvermelding, onzekerheid, fouten erkennen |
| Bron, datum en link uit de servergegevens, nooit uit het model; antwoord altijd aan één bericht gekoppeld | NVJ-code (controleerbaar), en geen verzonnen links |
| AI-label altijd in beeld, Nova doet niet alsof ze een mens is | NVJ-code (transparantie); doelgroeponderzoek: laag vertrouwen in AI-nieuws |
| Vragen niet bewaard, geen account, geen persoonlijke gegevens vragen | NVJ-code (privacy) |

De voorkeur voor het uiterlijk van de avatar verschilde in de interviews. De huidige presentator is een tijdelijke, ondersteunde standaard, geen gekozen eindbeeld.

Doelgroep: we houden **18–24 jaar** aan, zoals in ons doelgroeponderzoek. Het interviewdocument noemt 18–26 jaar en bevat iemand van 26. Dat verschil is bewust niet stilzwijgend aangepast. Het interviewdocument zelf staat niet in deze repository; de inzichten hier komen uit de samenvatting in de opdracht.

## Bekende beperkingen

- **Geen echte D-ID-stream getest.** Het account had op 27 oktober 2026 0 credits (plan `deid-trial`), en betaalde streams starten we niet automatisch. De stemkwaliteit van Maarten, de lipsync op deze foto, MediaRecorder op de D-ID-stream en de werkelijke facturering zijn dus nog onbekend.
- **Pauze bij deze agent is geen echte pauze** (Talks heeft geen interrupt): het fragment loopt bij D-ID door en telt mee in het verbruik. Houd fragmenten daarom kort (de basisuitleg is 60 tot 90 woorden, ongeveer 30 seconden).
- **Zinslengte.** Gemini 3.1 Flash Lite houdt zich niet altijd aan ongeveer 10 woorden per zin: bij "Wat betekent dit?" en "Vertel meer" gemiddeld 13 tot 16. Volg dat in `wordsPerSentence` in het testlog.
- **Gemini kan traag zijn.** Soms 10 tot 30 seconden, of een time-out gevolgd door de terugval. Voor Start merk je dat niet: de basisuitleg van het eerste bericht wordt al gemaakt zodra de pagina de berichten ophaalt, en die van het volgende bericht terwijl de gebruiker luistert. Daarna wordt hij bewaard in het geheugen van de server (per artikel- en promptversie, alleen de basisuitleg, geen vragen; zie `lib/corecache.ts`). Iedereen hoort zo ook dezelfde kern. De andere knoppen wachten nog wel op Gemini. Sneller: zet `GROQ_API_KEY` (gratis, console.groq.com) en/of `MISTRAL_API_KEY` in `.env.local`. De volgorde is Groq, Mistral, Gemini; alleen aanbieders met een sleutel doen mee, en de volgende neemt het over als de eerste faalt of te traag is (`lib/ai.ts`, `lib/groq.ts`, `lib/mistral.ts`). Het testlog toont per antwoord welk model het was. Let op: de gratis tier van Mistral mag invoer gebruiken voor training, ook vragen van deelnemers. Zet voor een gebruikerstest `GEMINI_MODELS=gemini-3.1-flash-lite`.
- **Herhalen uit het geheugen.** Of D-ID dat in de voorwaarden toestaat, hebben we niet kunnen bevestigen. Uit te zetten met `DID_LOCAL_REPLAY=0`.
- **Geen spraakinvoer.** De bestaande infrastructuur ondersteunt dat niet betrouwbaar, dus geen microfoonknop.
- **Rate limit en verbruiksteller** staan in het geheugen van één serverproces en in lokale bestanden: genoeg voor een lokaal prototype, niet voor productie.
- **Brontekst in de repository.** `data/test-articles.json` bevat de feedtekst van drie NOS-berichten. Is de repository openbaar, overweeg dan dat bestand lokaal te houden.
- **Bekende kwetsbaarheden in Next.js 15.5.25** (`npm audit`) bestonden al. We houden de frameworkversie bewust gelijk; los dit op met de kleinste veilige stap (`npm audit fix` zonder `--force`).
