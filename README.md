# Nova — digitale nieuwsverteller (prototype)

Webprototype voor de minor Digital Humans: een AI-presentator die nieuws uitlegt aan laaggeletterde jongvolwassenen van 18 tot en met 24 jaar. Doel van het prototype: testen of deze groep nieuws beter begrijpt. Na de uitleg moet iemand kunnen vertellen wat er is gebeurd, wie erbij betrokken zijn, waarom het belangrijk is en wat nog onzeker is.

De pagina opent direct op de presentator, met de titel van het eerste bericht, het label "AI-presentator" en één knop: **Start**. Pas daarna starten geluid, het taalmodel en (in de echte modus) de Anam-stream. Nova vertelt kort de kern en stopt. Daarna kiest de gebruiker zelf: **Leg makkelijker uit**, **Wat betekent dit?**, **Vertel meer**, **Nog een keer**, **Stel een vraag** (typen of inspreken) of **Volgend bericht**, plus **Pauze/Verder** en **Ondertiteling aan/uit**. Geen account.

Terug naar de versie van vóór dit prototype (LiveAvatar + browserstem): `git checkout voor-did-prototype`. De D-ID-versie staat in commit `6bcb8b7`.

## Starten

```bash
npm install
cp .env.example .env.local     # vul GROQ_API_KEY in (en voor Anam: zie hieronder)
npm run dev                    # http://localhost:3000
```

Standaard draait de **ontwikkelmodus** (`AVATAR_MODE=simulated`): Anam wordt niet aangeroepen, de antwoordtekst staat in beeld, en een gele balk meldt dat de avatar gesimuleerd is. Heeft de browser een Nederlandse stem, dan leest die voor.

### Echte Anam-stream

1. Zet `ANAM_API_KEY` in `.env.local` (lab.anam.ai → API keys).
2. Zet `ANAM_AVATAR_ID` (de avatar "Nova (foto)", gemaakt van de foto via `POST /v1/avatars`) en `ANAM_VOICE_ID` (de Nederlandse stem "Peter").
3. Zet `AVATAR_MODE=anam` en herstart `npm run dev`.

Het beeld en de wachtvideo vóór Start staan in `public/anam/`: gewone bestanden van dezelfde avatar, zodat het beeld bij Start niet verspringt. Een andere avatar: vervang die twee bestanden (of zet `ANAM_POSTER_URL` en `ANAM_IDLE_VIDEO_URL`). Alle variabelen staan met uitleg in [.env.example](.env.example).

### Tests

```bash
npm test          # met nagemaakte Anam-SDK en microfoon: geen sessie, geen kosten
npm run typecheck
```

## Structuur

```
data/test-articles.json        vaste testselectie: 3 NOS-berichten, brontekst + hulpnotities
lib/articles.ts                berichten per modus (test of live), artikelversie (hash)
lib/news.ts                    NOS-feed voor NEWS_MODE=live (15 min cache, terugval op demo)
lib/prompt.ts                  systeemprompt, PROMPT_VERSION, opdracht per knop
lib/ai.ts                      generateExplanation(): Groq, Mistral of Gemini, of de terugval
lib/groq.ts, lib/mistral.ts    taalmodellen via de chat-API in OpenAI-vorm (lib/openai-chat.ts)
lib/gemini.ts                  Gemini (REST, modellenlijst), als reserve
lib/corecache.ts               basisuitleg vooraf klaarzetten, met lage voorrang
lib/fallback.ts                regelgebaseerde terugval: alleen zinnen uit de bron
lib/spoken.ts                  gesproken tekst schoonmaken, zinnen splitsen
lib/validate.ts                validatie van /api/explain
lib/testlog.ts                 logs/answers.jsonl (metadata, geen gespreksinhoud)
app/api/news                   berichten (zonder brontekst), modi, beeld vóór Start
app/api/explain                uitleg bij één bericht en één knop
app/api/anam/session           kortlevend Anam-token, pas na Start
app/api/timing                 metingen per klik in de serverlog (alleen ontwikkelserver)
app/page.tsx                   state, bediening, panelen, ontwikkelpaneel
components/presenter/          gesimuleerde en Anam-presentator achter één interface
public/anam/                   beeld en wachtvideo van de avatar
tests/                         node --test
```

## Hoe een antwoord ontstaat

1. De pagina vraagt `/api/news`: titels, bron, datum en versie van de berichten. Geen brontekst, geen stream.
2. Na **Start** (of een knop, of een ingesproken vraag) stuurt de pagina `articleId`, `action` (`core`, `simpler`, `meaning`, `more`, `question`), eventueel de vraag, en de laatste uitleg bij **dit** bericht naar `/api/explain`.
3. De server zoekt het bericht op in de eigen gegevens. Het model kiest niet welk bericht het is, en bron, datum en link komen nooit uit het model.
4. Het taalmodel (Qwen via Groq; Mistral of Gemini als reserve) krijgt de systeemprompt, de brontekst, de hulpnotities en de opdracht voor die knop, en geeft `{"spoken": "..."}` terug. De server haalt markdown, URL's, emoji en regieaanwijzingen weg.
5. De pagina laat de presentator die tekst letterlijk uitspreken en toont dezelfde tekst als ondertiteling.

**Een vraag over ander nieuws van vandaag** (lib/questions.ts): het taalmodel meldt bij het antwoord of de vraag over het bericht in beeld ging. Zo niet, dan kiest het taalmodel uit de titels en het begin van de berichten van vandaag het bericht waar de vraag over gaat, en Nova antwoordt uit dát bericht ("Dat gaat over een ander bericht van vandaag."). De pagina gaat naar dat bericht, zodat bron, datum en "Bekijk bron" bij het antwoord horen. Staat het nergens, dan zegt Nova dat eerlijk. Gewone vragen kosten zo geen extra tijd; een vraag over een ander bericht ongeveer 1 seconde extra.

**Volgend bericht** stopt de lopende uitleg, breekt een lopende aanvraag af, wist de context van het vorige bericht en negeert een antwoord dat te laat binnenkomt. Snel dubbelklikken geeft één aanvraag. **Nog een keer** maakt geen nieuwe aanvraag.

### Inhoud vervangen

De testberichten staan in [data/test-articles.json](data/test-articles.json): id, korte titel, oorspronkelijke titel, uitgever, URL, publicatie- en updatedatum, ophaaldatum, brontekst, en hulpnotities (kernfeiten, voorwaarden, onzekerheden). Vervang of voeg toe met dezelfde velden. De artikelversie rekent de server zelf uit. Een test controleert dat elk getal in de hulpnotities ook in de brontekst staat. Met `NEWS_MODE=live` gebruikt Nova de actuele NOS-feed (zonder hulpnotities).

### Testlog

`logs/answers.jsonl` bewaart per antwoord: request-id, bericht, artikelversie, promptversie, knop, `ai` of `fallback`, model, aantal woorden en gemiddelde woorden per zin. Bewust niet: de vraag van de gebruiker of de tekst van het antwoord. Het staat in `.gitignore`. Op Vercel kan niets naar schijf: daar is er geen testlog.

## Anam: wat de integratie wel en niet kan

Gecontroleerd in oktober 2026, in anam.ai/docs en in de typen van `@anam-ai/js-sdk` (vastgezet op 4.29.1), en in een live proef:

- **Alleen onze tekst.** De persona wordt per sessie samengesteld op de server (`/api/anam/session`): ons gezicht, een Nederlandse stem en **geen taalmodel van Anam** (`llmId: CUSTOMER_CLIENT_V1`, "Disable LLM"). Nova zegt alleen wat onze server schrijft, via een talk-stream. Een persona uit Anam Lab wordt niet gebruikt.
- **Sleutels.** `ANAM_API_KEY` blijft op de server. De browser krijgt na Start alleen een kortlevend sessietoken.
- **Avatar en stem.** Avatar "Nova (foto)", gemaakt van de foto met het model Cara 4. Stem "Peter – Dutch e-learning narrator" (ElevenLabs, via Anam), de enige Nederlandse stem die we in de catalogus vonden.
- **Snelheid.** In de live proef: verbonden in 0,6 tot 1,5 s, Nova hoorbaar 2,1 s na Start en 1,3 s na een knop (waarvan ongeveer 0,7 s tekst). Bij D-ID was dat 11 tot 16 s.
- **Fragmenten.** Elk fragment krijgt een eigen correlationId. Anam stuurt die terug in de transcriptgebeurtenissen, verpakt als `external::<id>::…`. Zo is een laat event van een oud fragment zeker te herkennen. Komt er geen id mee, dan hoort het eerste nieuwe Anam-bericht bij het fragment.
- **Pauze.** Echt: `interruptPersona()` stopt meteen, en **Verder** spreekt de rest uit vanaf de zin waar Nova was.
- **Ondertiteling.** De zin in beeld volgt wat Anam al heeft uitgesproken (het transcript van de persona). In de live proef liep dat goed gelijk met de stem.
- **Vraag inspreken.** De SDK krijgt een eigen, stille geluidsstroom en vraagt dan zelf nooit om de microfoon. Pas als de gebruiker op **Spreek je vraag in** tikt, vraagt de browser toestemming en sluiten we de microfoon op die stroom aan, tot Anam het einde van de vraag meldt (of na 20 seconden, of bij nog een tik). Daarna gaat de microfoon helemaal uit. Anam maakt van de stem tekst; die tekst gaat als gewone vraag naar onze server. Wij bewaren de stem en de vraag niet.
- **Beeld vóór Start.** Het stilstaande beeld en de wachtvideo van dezelfde avatar, met dezelfde uitsnede als de stream. Bij het eerste echte beeld van Anam vloeit de wachtvideo in 0,45 s over in het live beeld, zonder harde wissel. Een klein verschil blijft: de wachtvideo is een scherp bestand, het live beeld een gecomprimeerde WebRTC-stream (Anam heeft geen instelling voor kwaliteit of resolutie). De log toont de resolutie van de stream (`[timing] … beeld … (BxH)`). Onder 60rem heeft het beeldvak een vaste maat (`app/stage-stable.css`), zodat Nova niet krimpt of verschuift als na Start tekst verschijnt.
- **Opruimen.** De verbinding sluit bij het verlaten van de pagina, bij een verborgen tabblad en na 2 minuten stilstand. Die timer loopt alleen als Nova klaar of gepauzeerd is, nooit tijdens genereren, verbinden, spreken of luisteren. Een sessie duurt hooguit 15 minuten. Een verbinding die nog wordt opgebouwd als er wordt afgesloten, gaat meteen dicht zodra hij klaar is.
- **Metingen (ontwikkelserver).** Per klik één regel `[timing]` in de serverlog: cachestatus (`ready`, `pending` of `miss`), duur en afloop van elke modelpoging, tekst binnen, verbinden, versturen, eerste beeld, en waarom een verbinding dicht ging. Alleen getallen, geen tekst.

### Kosten

Anam rekent per minuut sessie. In de ontwikkelmodus wordt Anam niet aangeroepen; de echte stream start pas na **Start**. Een openbare deployment kan door iedereen met de link minuten verbruiken: zet er bescherming op (Vercel Authentication) of houd de link voor jezelf.

## Taal en journalistiek

De regels staan in `SYSTEM` in [lib/prompt.ts](lib/prompt.ts), gegroepeerd als rol, taal, opbouw, gesprek, journalistieke zorgvuldigheid, presentatie, veiligheid en antwoordformaat. Verander je de inhoud, verhoog dan `PROMPT_VERSION`. De opdracht per knop staat in `TASKS`. De basisuitleg is 60 tot 90 woorden: een instelbaar startpunt (`NOVA_CORE_WORDS`), geen onderzoeksuitkomst.

Valt het taalmodel weg (geen sleutel, quotum, time-out), dan kiest de terugval in [lib/fallback.ts](lib/fallback.ts) zinnen uit de bron. Ze verzint niets, maar herschrijft ook niet. De interface meldt het dan: "De AI werkt nu niet".

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

- **Zinslengte.** Qwen houdt zich meestal aan korte zinnen (ongeveer 7 tot 8 woorden), maar een reserve-model zoals gpt-oss schrijft langere (12 tot 17). Volg dat in `wordsPerSentence` en `model` in het testlog.
- **Minuutlimiet van Groq.** De gratis tier geeft per model 8000 tokens per minuut, ongeveer 2 antwoorden. Daarna neemt het volgende model het over (gpt-oss, dan Gemini). Voor een gebruikerstest: de betaalde Developer-tier van Groq.
- **Spraakherkenning door Anam.** Een ingesproken vraag gaat naar Anam om er tekst van te maken. Vermeld dat in de uitleg voor deelnemers.
- **Rate limit en voorbereide basisuitleg** staan in het geheugen van één serverproces: genoeg voor een lokaal prototype, niet voor productie.
- **Brontekst in de repository.** `data/test-articles.json` bevat de feedtekst van drie NOS-berichten. Is de repository openbaar, overweeg dan dat bestand lokaal te houden.
- **Bekende kwetsbaarheden in Next.js 15.5.25** (`npm audit`) bestonden al. We houden de frameworkversie bewust gelijk; los dit op met de kleinste veilige stap (`npm audit fix` zonder `--force`).
