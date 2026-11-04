# Review Nova-vragen — 4 november 2026

Advies: vervang de huidige beslisketen door één classificatiestap vóór het antwoorden. Houd selectie van bronnen, validatie van id's, datumfilters en foutafhandeling in gewone code. Laat het model expliciet `onzeker` kiezen. Eén JSON-uitkomst helpt, maar maakt een gemist bericht niet ineens bewijs voor “geen nieuws”. Eerst een herhaalbare integratie-evaluatie; deze review verandert geen appgedrag.

Onderzocht op `design-preview`, HEAD `367a5a8`, inclusief de acht commits na `f87a706`. Werkboom was vooraf schoon. Geen prompts of productiecode gewijzigd; geen Anam-stream, commit of push. Geen vraag- of antwoordtekst in `logs/` opgeslagen. De bestaande Anam-tests gebruiken nepclients, geen betaalde sessies.

## Bevindingen, ernstigste eerst

### F5 — Een mislukte of onzekere selectie wordt een feitelijke ontkenning

**Hoog.** `lib/questions.ts:209`, `lib/questions.ts:214`, `lib/questions.ts:153`, `lib/ai.ts:107`, `lib/prompt.ts:103`.

Vraag bij Haarlem: **“Wat gebeurt er in Oekraïne?”**, terwijl het Oekraïnebericht in de lijst staat. Als het eerste model `overBericht:false` geeft en het zoekmodel twijfelt (`id:null`), zegt Nova “Ik heb vandaag geen nieuws over Oekraïne.” Ook een onbekend id, ontbrekend id of ongeldige JSON wordt door `pickRoute` `null`. Een inhoudelijk ongeschikt tweede antwoord eindigt eveneens als “geen nieuws”. Technische schemafout, twijfel, gemiste bron en echte afwezigheid zijn dus niet te onderscheiden. De routeprompt draagt juist op bij twijfel null te kiezen.

De kandidaatselectie beperkt dit verder: maximaal 90 berichten, geen huidig artikel, slechts 110 tekens begintekst, geen regio of publicatietijd (`questions.ts:132`). Staat een relevante plaats pas verder in de bron, dan kan selectie hem missen. Vraag **“Wat gebeurt er in Gaza?”** bij een artikel waarvan Gaza alleen verderop wordt genoemd: de router kan de beschikbare bron niet zien. De prompt vraagt het nieuwste passende bericht, maar krijgt geen tijd en de Nederlandse openingsvolgorde is niet strikt chronologisch.

Test: TODO “mislukte zoekkeuze is geen bewijs…”, plus karakterisering van ongeldige JSON. Gewenst: apart `geen_match`, `onzeker`, `ongeldig` en `zoekfout`; geen stellige ontkenning op basis van twijfel. Beschrijf bovendien de scope: beschikbare NOS-berichten, niet alle nieuws ter wereld.

### F1 — “Vandaag”, “gisteren” en relatieve tijd worden niet consequent afgebakend

**Hoog.** `lib/questions.ts:45`, `lib/questions.ts:95`, `lib/questions.ts:106`, `lib/news.ts:73`, `lib/news.ts:132`, `lib/prompt.ts:103`.

**“Geef het nieuws van gisteren”** passeert de woordenlijst en trigger `nieuws`, maar `newsWindow` vindt geen minutenvenster. Resultaat: de eerste vijf huidige Nederlandse berichten, zonder filter op gisteren. **“Wat is er gisteren gebeurd?”** wordt daarentegen niet direct als overzicht herkend: gisteren is geen trigger. Ook **“Wat is het nieuws van vanochtend?”** filtert niet op ochtend.

De feeds worden nooit op Nederlandse kalenderdag gefilterd. Kandidaten en overzichten kunnen oudere berichten bevatten, terwijl prompt en vaste aankondiging spreken over “vandaag”. Een Amerikaans bericht van gisteren krijgt bij een wissel “buitenlands nieuws van vandaag”. Dit is zichtbaar zonder aanname over modelkwaliteit. Een minutenvenster moet ook een bovengrens krijgen: toekomstige publicaties tellen nu mee (F8, `questions.ts:80`).

Tests: TODO voor gisteren en toekomstige publicatie. Gewenst: expliciet dag-/tijdcontract, Amsterdamse daggrenzen en datumvalidatie; niet ongemerkt “gisteren” veranderen in actueel nieuws.

### P1 — Bewaren van een verdwenen bericht werkt alleen in de browser

**Hoog.** `app/page.tsx:208`, `lib/articles.ts:85`, `app/api/explain/route.ts:32`.

Reproductie: open Haarlem, laat het uit de feed verdwijnen, ververs de lijst, vraag **“Wat gebeurde er daarna?”**. De pagina bewaart de metadata netjes, maar `findArticle` zoekt uitsluitend in de nieuwste serverlijst. De vraag krijgt 404; de bewaarde titel blijft staan. De client bewaart geen brontekst en de server bewaart geen artikelsnapshot. Dat maakt doorvragen onmogelijk, ook al lijkt het gesprek behouden.

Gewenst: begrensde serveropslag van recent getoonde versies of een expliciete melding dat het bericht verlopen is. Niet de client als bron van ongevalideerde nieuwsinhoud gebruiken. Statische bevinding; geen browserreproductie uitgevoerd.

### P2 — Een antwoord kan bij een andere titel/bron in beeld terechtkomen door verversen

**Hoog, afhankelijk van timing.** `app/page.tsx:204`, `app/page.tsx:325`, `app/page.tsx:341`.

Reproductie: lijst `[Haarlem, stikstof, Amerika]`; vraag bij Haarlem **“Wat is er vandaag in Amerika gaande?”**. `explain()` onthoudt deze lijst in zijn closure. Terwijl de aanvraag loopt, komt een nieuw Nederlands bericht vooraan. Refresh bewaart Haarlem op zijn nieuwe index. Het antwoord kiest vervolgens Amerika met de **oude** index 2; in de nieuwe lijst staat daar stikstof. Het fragment noemt Amerika, maar de getoonde titel en bron zijn van stikstof. Alleen als het id niet in de oude lijst stond, wordt opnieuw ververst. `seq` verandert niet door normale refresh en voorkomt deze race niet.

Gewenst: geselecteerd id als state, index afleiden uit actuele lijst; atomair antwoord/context koppelen op id. Bescherm ook tegen overlappende refresh-aanvragen die in omgekeerde volgorde terugkomen. Statische bevinding; geen DOM-test toegevoegd die codefragmenten zou nabootsen in plaats van React te testen.

### F2 — De woordenlijst verwart taalkundige vorm met bedoeling

**Middel/hoog.** `lib/questions.ts:45`, `lib/questions.ts:86`, `lib/questions.ts:95`, `lib/questions.ts:34`, `lib/questions.ts:205`.

**“Wat is nieuws?”** is een begripsvraag maar wordt zonder model een nieuwsoverzicht. **“wat speelt er momenteel in nederland”** is wel een overzicht, maar `momenteel` staat niet in de lijst. Andere missers: **“vertel het wereldnieuws”**, **“wat is er buiten nederland gebeurd”**, **“heb je iets nieuws”**, **“nieuws van de afgelopen zes uur”**. Woorden als zes, zeven, acht en negen ontbreken in zowel woordenlijst als getallenparser; cijfers werken wel. **“Wat is er internationaal gebeurd?”** bevat toegestane woorden maar mist de trigger voor een overzicht. Hoofdletters en gewone leestekens worden goed genormaliseerd; spraakfouten zoals “kongres” krijgen geen expliciete behandeling.

Het generieke onderwerpvangnet accepteert maar één optioneel voorvoegsel: “het laatste nieuws”, “het andere nieuws”, “buitenlands nieuws” vallen erbuiten. Zelfs wanneer het wél een overzicht maakt, forceert de code regio `nl` en tijdvak `null`. Een door de router opgevangen buitenland-/tijdvraag kan dus alsnog een Nederlands, onbegrensd overzicht worden.

Tests: TODO voor spreektaal en begripsvraag; parserkarakterisering. Niet oplossen door nog tientallen woorden toe te voegen: dat maakt juist de bedoeling niet expliciet.

### F3 — Antwoordtekst krijgt voorrang op de routebeslissing

**Middel/hoog.** `lib/questions.ts:188`, `lib/ai.ts:90`.

Vraag **“Wat gebeurt er in Oekraïne?”** bij Haarlem. Modeluitvoer `{spoken:"Ter uitleg: Dit bericht gaat niet over Oekraïne.", overBericht:false}` blijft bij Haarlem. “Ter uitleg:” heeft absolute voorrang, ook midden in de tekst. De prompt bedoelt dit label voor algemene kennis, niet als bewijs van een correcte bronkeuze.

Omgekeerd wordt ontbrekend `overBericht`, `null` of de string `"false"` stilzwijgend true (`parsed.overBericht !== false`). Zegt het model **“Daar staat hier niets over.”** met zo'n vlag, dan zoekt de regex niet verder. Technisch geldige JSON is hier geen gevalideerd schema. Test: TODO voor `Ter uitleg`, karakterisering voor gemiste afwijzing. Gewenst: route uit een gevalideerde beslissing, onafhankelijk van uitgesproken proza.

### F6 — De tekstregex ziet ook gewone inhoud als afwijzing

**Middel.** `lib/questions.ts:166`.

Vraag **“Praten de partijen over Oekraïne?”** bij een passend onderhandelingsbericht. Correct antwoord **“Volgens dit bericht praten de partijen niet over Oekraïne.”** activeert `saysNotAbout`: `bericht` plus `niet over` in dezelfde zin. Daarna zoekt Nova elders en kan ten onrechte “geen nieuws” zeggen. Varianten als **“Het artikel gaat niet over Oekraïne.”** worden juist gemist, omdat `artikel` geen `bericht` is. Test: TODO voor de onterechte afwijzing. Ook dit verdwijnt beter met een routecontract dan met meer regexen.

### F4 — Bij één beschikbaar artikel blijft het afgewezen antwoord staan

**Middel.** `lib/questions.ts:192`.

Alleen de stikstofwet beschikbaar, vraag **“Wat gebeurde er in Gaza?”**, model zet false. Lege kandidatenlijst geeft `stay` terug: **“Dit bericht gaat over de stikstofwet, niet over Gaza.”** Precies het gedrag dat de demo-aanpassing wilde voorkomen. Test: TODO met één artikel. Gewenst: een scopegebonden geen-match-antwoord zonder irrelevante herhaling.

### F7 — Modelpogingen raken op foutpaden uit de metingen kwijt

**Middel.** `lib/questions.ts:196`, `lib/questions.ts:202`, `lib/questions.ts:209`, `lib/questions.ts:212`.

Vraag **“Wat gebeurde er in Gaza?”**: eerste antwoord en router kosten elk een aanroep. Bij geen match bevat `attempts` alleen het eerste antwoord. Ook een afgewezen tweede antwoord en mislukte routepogingen ontbreken. Daardoor lijken juist lastige vragen goedkoper/sneller in de providerstatistiek dan ze zijn. `generateMs` omvat wel het hele pad. Test: TODO voor behoud van routepogingen. Bewaar uitsluitend metadata; geen teksten toevoegen aan logs.

### Overige prompt- en bronproblemen

`SYSTEM` vraagt direct antwoorden en uitsluitend het huidige bericht behandelen; `TASKS.question` geeft geen mogelijkheid een overzicht te kiezen. Daarom moet een gemiste overzichtsvraag eerst een artikelantwoord doorlopen. `ROUTE_SYSTEM` heeft helemaal geen overzichtuitkomst; `onderwerp` wordt daarvoor achteraf hergebruikt. Dat is een impliciet tweede protocol.

`OVERVIEW_SYSTEM` zegt “nieuwste” en “houd de volgorde aan”, maar de NL-lijst begint met drie tekstvolle openingsberichten, vóór mogelijk nieuwere korte berichten (`news.ts:143`, `questions.ts:106`). **“Wat is het nieuwste nieuws?”** kan dus nieuws overslaan. Een overzicht krijgt geen eigen context-id in de pagina: `data.overview` wordt niet in de gespreksstate gebruikt. **“Wat bedoel je met dat tweede bericht?”** wordt daarna beantwoord met het oude artikel als bron. Een classifier moet ook overzichtcontext krijgen.

Zinslengte, totale woordenlimieten en A2 zijn promptwensen, geen harde uitvoerchecks. Algemene kennis is toegestaan onder “Ter uitleg”, ook over personen en plaatsen; daarvan is juistheid niet met de aangeleverde bron bewezen. Bronprompt en routeprompt behandelen input als inhoud, maar JSON-modus valideert geen feitelijke juistheid of schema. Geen bewijs gevonden dat de prompts alle denkbare instructies in nieuwsinhoud kunnen neutraliseren; dit is geen uitgevoerde injectiebenchmark.

## Pagina en ondertiteling

`homeCount` en `next()` werken bij de door `getStories` gegarandeerde volgorde: alle NL-berichten vooraan, buitenland achteraan. Na een buitenlands bericht gaat Volgend naar het eerste Nederlandse bericht. Een verdwenen Nederlands bericht wordt vooraan bijgeplaatst; een verdwenen buitenlands bericht achteraan. Die invarianten kloppen. Bij nul Nederlandse berichten doet Volgend niets; de live server biedt nu ook geen bruikbare lijst als alle Nederlandse feeds falen.

Een normale refresh tijdens spreken stopt de presentator niet en behoudt de selectie op id. Dat is goed. Wel kan dezelfde id inmiddels andere titel/versie hebben terwijl het fragment de oude versie vertelt; P2 gaat daarnaast over de ernstiger indexrace bij een antwoordwissel.

Ondertiteling met timing verdwijnt zodra de presentator `ready` meldt. Zowel de gesimuleerde presentator als Anam sturen bij einde zinindex -1 en ready (`simulated.ts`, `anam.ts:339`); `page.tsx:661` vraagt speaking of paused. De fallback naar index 0 toont normaal dus niet alsnog de eerste zin na afloop. Bij `timing === 'none'` blijft de volledige tekst bewust staan, ook na een mislukte verbinding. Dat is een uitzondering op “verdwijnt na de laatste zin”, geen aangetoonde regressie in normale timing. Geen echte Anam-sessie of browser gestart.

## Huidig pad, modellen en grenzen

1. `POST /api/explain`: maximaal 20 aanvragen per minuut per afgeleid IP/proces; valideert artikel-id en actie. Vraag maximaal 300 tekens, maximaal zes eerdere uitingen van elk maximaal 1500 tekens. Artikel moet nog op server staan.
2. Vaste overzichtsherkenning: regio en eventueel minutenvenster, maximaal vijf berichten. Zonder recente berichten: vaste tekst zonder model.
3. Anders eerste artikelantwoord. Bij fallback, “Ter uitleg:” of niet-afgewezen artikel: klaar.
4. Anders router over maximaal 90 andere berichten. Geen match/generiek/zoekfout geeft vaste tekst of overzicht. Match geeft derde aanroep met lege eerdere context, daarna bronwissel en vaste aankondiging.

De lokale configuratie heeft Groq- en Gemini-sleutels, geen OpenAI- of Mistral-sleutel; geen sleutelwaarden getoond of opgenomen in dit rapport. `AI_PROVIDERS` is lokaal niet ingesteld. Effectieve volgorde uit de code is daarom Groq, Gemini. Namen `openai/gpt-oss-*` zijn Groq-modelnamen: daarvoor is geen OpenAI-sleutel nodig.

Groq-standaard: `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, per model timeout 8 seconden. Alle fouten proberen het volgende model, niet uitsluitend 429. Geen cooldown, geen interpretatie van Retry-After en geen gedeeld totaalbudget. Alle drie falen kost tot circa 24 seconden per generatiestap. Gemini daarna: `gemini-3.1-flash-lite`, `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash`; totaalbudget 30 seconden per generatiestap, maximaal 20 seconden per model, cooldown voor 429/503. Beschikbaarheid van deze defaults is niet met een modelaanroep geverifieerd.

Beide sturen temperature 0.4 en maximaal 2048 uitvoertokens. Geen schema met enums/vereiste velden. Geen end-to-end deadline over maximaal drie stappen: bij problemen kan één vraag veel langer dan 30 seconden duren. De client kan stoppen met wachten, maar het Request-abortsignaal wordt niet aan de providerfetches doorgegeven.

De genoemde circa 8000 tokens per minuut komt overeen met de gepubliceerde Groq free-plan-tabel voor de genoemde modellen; limieten gelden per organisatie en zijn model-/plan-afhankelijk. Accountspecifieke grenzen zijn niet uit een accountdashboard gecontroleerd. Zie [Groq Rate Limits](https://console.groq.com/docs/rate-limits). Een interval lost niet op dat één omvangrijke router-/antwoordaanroep al veel tokens kan kosten.

Een modelwissel kan binnen dezelfde vraag plaatsvinden: eerste vlag van Qwen, selectie van GPT-OSS, antwoord van Gemini. De toon, A2-niveau en twijfelgrens zijn dan niet constant. Er is geen garantie dat een volgend model hetzelfde routeoordeel geeft. Leg model per stap vast en vergelijk evaluaties per modelpad; alleen het eindmodel is onvoldoende. Kernvoorbereiding na `/api/news` gebruikt bovendien hetzelfde quotum.

## De zes demo-regressies

Historisch foutgedrag hieronder komt uit de aangeleverde reviewprompt; waar geen letterlijk antwoord beschikbaar was, staat een beschrijving, geen verzonnen citaat.

| In beeld | Vraag | Historisch fout | Gewenst |
|---|---|---|---|
| Willekeurig | Wat gebeurde er vandaag? | Herhaalde huidig bericht | Overzicht Nederlands nieuws |
| Haarlem | wat is er vandaag in amerika gaande | Eerst niets, later NL-overzicht | Amerikaans bericht; begin “Dat gaat over buitenlands nieuws van vandaag.” |
| Amerikaanse verkiezingen | wat is het Congres | NL-overzicht | Begripsuitleg bij artikel met “Ter uitleg:” indien buiten bron |
| Stikstofwet, geen Gaza-bron | wat gebeurde er in gaza | “Dit bericht gaat over de stikstofwet” | “Ik heb vandaag geen nieuws over Gaza.” |
| Stikstofwet, na Gaza | waar heb je wel nieuws over | “Ik heb geen nieuws over nieuws” | Nederlands overzicht |
| Haarlem | Wat gebeurt er in Oekraïne? | Tekst zei niet over Oekraïne, vlag true | Selectie Oekraïnebericht, buitenlandse aankondiging |

Zes tests controleren deze paden met voorgeschreven nepmodeluitvoer. Dat bewijst de afhandeling van die uitvoer, niet dat Groq het juiste artikel of juiste vlag kiest.

## Evaluatie en nieuwe bestanden

`evaluation/questions.nl.json`: 72 vragen, met context, getypt/gesproken transcript, categorie en inhoudelijke rubric. Zes zijn afkomstig uit de gemelde demo's; de overige 66 zijn nieuw geschreven. Geen verzameling van echte deelnemergesprekken. Vier synthetische broncontexten staan in `evaluation/context.nl.json`. Die houden beschikbaarheid stabiel en doen geen uitspraken over werkelijk nieuws.

| Categorie | Aantal | Live goed/totaal |
|---|---:|---|
| Huidig bericht | 10 | Niet uitgevoerd |
| Begrip | 11 | Niet uitgevoerd |
| Ander NL-bericht | 10 | Niet uitgevoerd |
| Buitenlands bericht | 11 | Niet uitgevoerd |
| Overzicht NL | 10 | Niet uitgevoerd |
| Overzicht buitenland | 10 | Niet uitgevoerd |
| Geen nieuws | 10 | Niet uitgevoerd |

Op `localhost:3000` draaide geen server (HTTP-probe: verbinding geweigerd). Belangrijker: de huidige testmodus bevat drie andere artikelen en forceert alle regio's naar NL (`articles.ts:58`). Een willekeurige live feed levert geen vaste demo-context. Daarom geen server gestart om daar ten onrechte percentages aan te ontlenen. Voor een volledige herhaalbare API-run ontbreekt nog fixture-injectie in de nieuwslaag. Die is bewust niet als ongeteste gedragswijziging toegevoegd. Dit beperkt de levering tot een gecontroleerde testset, runner en deterministische reviewtests, zonder live-modelresultaten.

`scripts/evaluate-questions.mjs` speelt de set serieel af, controleert context-id's vooraf en wacht standaard 90 seconden na elk antwoord en na nieuwsvoorbereiding. Minimaal circa 108 minuten voor de hele set, plus generatietijd. Rapporteert per categorie structuurresultaat apart van inhoud. `--review` laat een beoordelaar rubric/antwoord vergelijken; zonder die beoordeling geen claim van inhoudelijke correctheid. Geen automatische modelbeoordelaar die extra Groq-aanroepen kost. Gebruik en beperkingen staan in `evaluation/README.md`. Alleen API-aanroepen; geen Anam-stream of tekstbestanden in logs.

`tests/questions-review.test.ts`: setvalidatie, zes demo-regressies, negen TODO-tests met gewenste maar nu falende uitkomst, karakterisering van ongeldige routing en controle van de evaluator. TODO is nadrukkelijk open schuld, geen succes. `npm test` moet na latere oplossingen die TODO-vlag verliezen.

## Ontwerpkeuze en overstap

Kies een classifier met een gevalideerde discriminated union, bijvoorbeeld:

```ts
type Beslissing =
  | { soort: 'dit_bericht' }
  | { soort: 'begrip'; begrip: string }
  | { soort: 'ander_bericht'; id: string }
  | { soort: 'overzicht'; regio: 'nl' | 'buitenland'; minuten: number | null }
  | { soort: 'geen_match'; onderwerp: string }
  | { soort: 'onzeker'; verduidelijking: string };
```

Voeg voor gisteren/ochtend een expliciet kalender-/tijdvaktype toe vóór je die vragen als ondersteund beschouwt. Geef huidig artikel, recente gesprek-/overzichtcontext en kandidaten met datum/regio mee. Valideer velden en ids strikt; onbekend schema is technische fout, geen geen-match. De classifier schrijft geen uit te spreken nieuwsantwoord. Gewone code kiest de bron en filters, een aparte antwoordstap gebruikt alleen die bron. Labels zoals “Ter uitleg:” blijven presentatie en sturen de route niet meer.

| Vraag | Nu: logische modelstappen | Classifier + antwoord |
|---|---:|---:|
| Huidig bericht / begrip | 1 | 2 |
| Ander bericht | 3 | 2 |
| Geen match | 2 | 1, vaste tekst |
| Overzicht | 1 | 2, of 1 bij vaste lege-tijdvaktekst |

Providerherpogingen staan hier los van. De verwachting “altijd minder Groq-aanroepen” klopt dus niet. Zonder mislukte pogingen: huidig gemiddeld `1 + 2*p(ander) + p(geen-match)`; nieuw `2 - p(geen-match)`, met de lege-overzichtuitzondering buiten de formule. Nieuw is in deze vereenvoudiging pas goedkoper als `p(ander) + p(geen-match) > 0,5`. Bovendien krijgt classificatie elke keer de kandidaten mee, wat meer invoertokens voor gewone vragen kan betekenen. De winst is primair één toetsbare beslissing; wachttijd/quotum moeten gemeten worden. Voor zoekvragen verdwijnt wel de onnodige eerste antwoordgeneratie.

Overstap in afgebakende stappen:

1. Maak een afgeschermde fixturebron met dezelfde vier contexten, correcte regio's, vaste klok en ook verdwenen-versiegevallen. Behoud alle bestaande tests. Zet de negen TODO's om naar gewone tests zodra hun gedrag wordt aangepakt; voeg echte React-tests toe voor refresh/antwoordraces.
2. Bouw classifier en schema-parser als losse functies met nep-afhankelijkheden. Test alle categorieën en expliciete fouten: verkeerd id, ontbrekende soort, kapotte JSON, twijfel, geen kandidaat, uitgeput model, verkeerde regio/tijd. Verhoog PROMPT_VERSION bij nieuwe promptinhoud.
3. Vergelijk oud en nieuw op dezelfde 72 cases per beschikbaar model; meerdere rustige herhalingen. Rapporteer confusion matrix, onterechte geen-match, feiten/A2, p50/p95-wachttijd, alle modelpogingen en echte tokenverbruikdata waar beschikbaar. Eén model vast per meetrun; fallback apart rapporteren.
4. Schakel de complete route per aanvraag om, niet eerst classificeren en daarna alsnog woordenlijst/vlag/regex laten beslissen. Verwijder de oude autoriteiten wanneer de vaste regressies en inhoudelijke beoordeling slagen.
5. Bewaar de classifieruitkomst en modelmetadata tekstvrij in metingen. Koppel de pagina op artikel-id en versie, en houd overzichtcontext apart. Blijf de set uitbreiden met geanonimiseerde, daarvoor toegestane echte testvragen; laat een onafhankelijke beoordelaar die labelen.

De aanbeveling volgt uit de aangetoonde conflicterende beslissingen, niet uit de aanname dat een classifier feilloos of per definitie goedkoper is. De live betrouwbaarheid van de voorgestelde aanpak is nog niet gemeten.

Validatie op Node v26.4.0: `npm test` telt 122 tests: 113 geslaagd, 0 gewone fouten, 9 verwachte TODO-fouten. `npm run typecheck`, de runner met `--dry-run` en `git diff --check` slagen. Oorspronkelijke basis: 104 geslaagde tests. Alleen de hierboven genoemde zes nieuwe bestanden toegevoegd; productiecode en configuratie ongewijzigd.
