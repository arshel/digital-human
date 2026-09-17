# Nova — AI virtual news anchor (prototype)

Webprototype voor de minoropdracht: een digitale nieuwspresentator voor jongeren. De app opent direct op de presentator. Nova haalt het actuele nieuws uit de NOS-feed, begroet je, noemt drie onderwerpen, en daarna vraag je door met vier vaste knoppen — "Leg het makkelijker uit", "Wat betekent dit?", "Waarom is dit belangrijk?" en "Volgende onderwerp" — of met je eigen vraag. Er is nog geen echte avatar.

## Starten

```bash
npm install
cp .env.example .env.local   # zet GEMINI_API_KEY erin
npm run dev
```

Open http://localhost:3000

## Structuur

```
lib/news.ts                  haalt de NOS-feed op (15 min cache), zet drie openingsverhalen vooraan, terugval op demo
data/articles.json           demo-artikelen voor als de feed niet bereikbaar is
lib/ai.ts                    AI-service: generateNewsResponse(), systeeminstructie, artikelcontext
lib/gemini.ts                het enige bestand dat Gemini kent (REST-aanroep, key uit .env.local)
lib/fallback.ts              regelgebaseerde terugval als Gemini ontbreekt of faalt
app/api/anchor/route.ts      serverroute: validatie, rate limit, roept generateNewsResponse() aan
app/page.tsx                 gespreksstate, huidig antwoord, snelle acties, invoer, bronnen
components/AnchorStage.tsx   beeld van de presentator (plek voor de realtime avatar)
app/globals.css              designtokens en layout
```

## De flow

1. De pagina laadt en vraagt `/api/anchor` om een opening, met een lege gespreksgeschiedenis.
2. De route valideert de aanvraag (zie "Grenzen aan de API") en haalt de verhalen op via `getStories()` in `lib/news.ts`.
3. De server geeft Gemini de systeeminstructie, een begrensde selectie artikelen (genummerd, met id, bron, datum en tekst) en het actieve onderwerp.
4. Gemini antwoordt in JSON: `{ text, articleId }`. `lib/ai.ts` controleert dat `articleId` echt een van de geladen artikelen is en voegt `mode` toe (`ai` of `fallback`).
5. De server stuurt ook de verhalen mee terug. De pagina toont `text` onder het beeld, zet het actieve artikel en laat de bron zien.
6. Bij elke vraag stuurt de pagina de geschiedenis, het actieve `articleId` en de ids van de verhalen mee — nooit artikeltekst. Zo snapt Gemini "die eerste", "dit" en "volgende onderwerp", en blijft het gesprek bij dezelfde verhalen in dezelfde volgorde, ook als de feed intussen ververst.

### De opening: precies drie verhalen

De opening noemt bewust drie berichten van elk hooguit twee zinnen. Meer is voor de doelgroep (jongeren en laaggeletterden) te veel om te onthouden, en het houdt de uitzending kort. Het getal staat als `OPENING_COUNT` in `lib/news.ts`; `getStories()` zet die drie vooraan.

Na de opening zit de gebruiker niet vast aan die drie. De rest van de feed staat erachter, dus "volgende onderwerp" loopt door naar bericht 4, 5 enzovoort, en een vraag over ander nieuws wordt gewoon beantwoord. Er staat expres geen onderwerpenteller in de interface: Nova is een presentator, geen lijst.

De opening hoort bij geen enkel artikel, dus `articleId` is dan `null` — ook in de terugval. De interface toont daardoor de drie bronnen van de opening, en de lower third blijft algemeen ("Het nieuws van vandaag"). Elk volgend antwoord hoort bij één artikel en toont alleen die bron.

## Nieuws uit de NOS-feed

`lib/news.ts` haalt https://feeds.nos.nl/nosnieuwsalgemeen op de server op, zonder extra pakket. De XML wordt met een kleine eigen parser gelezen, met HTML naar platte alinea's.

- **Selectie:** alle berichten uit de feed, met vooraan de drie voor de opening: de nieuwste met minstens 400 tekens tekst, zodat er iets is om over door te vragen. Zijn dat er te weinig, dan vult het aan met kortere berichten.
- **Cache:** 15 minuten. Zo haalt niet elke vraag de feed opnieuw op, en verschuiven de verhalen niet midden in een gesprek.
- **Terugval:** is de feed niet bereikbaar (time-out na 6 s) of leeg, dan gebruikt Nova de demo-artikelen uit `data/articles.json`. De interface meldt dat. De fout staat in de terminal als `[news] NOS-feed niet gebruikt ...`, en na een minuut probeert de server het opnieuw.
- **Bron:** elk verhaal heeft "NOS" als bron en de link naar het echte artikel.
- **Grens:** Nova weet alleen wat in de feed staat. Bevat de feed maar een samenvatting, dan zegt Nova vaker dat ze iets niet weet. Volledige artikelen van nos.nl scrapen doen we bewust niet: dat breekt snel en het is hun content.

## Grenzen aan de context

Een gesprek mag niet onbeperkt groeien: elke vraag stuurt de hele context opnieuw mee, en dat kost tokens en quotum. De grenzen staan bovenin `lib/ai.ts`.

- **Hooguit 15 berichten** in de prompt. Altijd de drie uit de opening (daar verwijst "die eerste" naar), plus het actieve bericht en de berichten daarna, aangevuld met de rest. Zo heeft "volgende onderwerp" altijd een bericht. De nummering is de positie in de hele lijst, dus verwijzingen blijven kloppen als de selectie schuift.
- **Tekst per bericht:** het actieve bericht gaat vrijwel volledig mee (2400 tekens), de rest alleen de kern (700 tekens). Vraagt de gebruiker naar zo'n bericht, dan is het de beurt daarna actief en komt de rest van de tekst alsnog. Een ingekort bericht is in de prompt gemarkeerd, en Nova mag niet gokken naar wat er weggelaten is.
- **Gespreksgeschiedenis:** de laatste 11 beurten (12 als er één bij moet omdat vraag en antwoord elkaar moeten afwisselen). Genoeg voor "leg dat nog eens uit", zonder dat een lang gesprek de aanvraag laat groeien.

In een test met een feed van 20 berichten en 30 gespreksbeurten ging de prompt hiermee van ongeveer 12.000 naar 4.400 tokens.

## Grenzen aan de API

`app/api/anchor/route.ts` behandelt de body als `unknown` en valideert die voordat er iets mee gebeurt. Fout is fout: één duidelijke melding en HTTP 400, nooit een 500.

- `messages` is een array van hooguit 40 beurten; elke beurt heeft rol `user` of `assistant` en tekst van 1 tot 2000 tekens.
- `storyIds` is een array van hooguit 60 strings van elk hooguit 80 tekens.
- `activeArticleId` is een string van hooguit 80 tekens, of `null`.

Daarnaast een rate limit van 20 aanvragen per minuut per IP, met HTTP 429 en een `retry-after`-header. Die telt in het geheugen van het serverproces: geen extra pakket, genoeg voor een prototype en een demo. **Voor een publieke productieomgeving is dit niet genoeg:** bij meerdere serverinstanties telt elke instantie apart, en bij een herstart begint de teller opnieuw. Daar hoort een gedeelde teller bij (bijvoorbeeld Upstash Redis) of de rate limit van het platform zelf (bijvoorbeeld Vercel Firewall).

## AI-provider los van de app

De app roept alleen `generateNewsResponse()` in `lib/ai.ts` aan. Welk model erachter zit, staat alleen in `lib/gemini.ts`. Voor OpenAI of Claude schrijf je een bestand met dezelfde functie (`generateJson(system, messages)`) en pas je één import in `lib/ai.ts` aan.

- Er is geen npm-pakket voor Gemini nodig: de officiële REST-API wordt met `fetch` aangeroepen.
- Het model is `gemini-3.6-flash`. Is dat op (gratis quotum, 429) of overbelast (503), dan probeert de app `gemini-3.8-flash`, `gemini-3.5-flash` en `gemini-3.1-flash-lite`. Een eigen lijst zet je met `GEMINI_MODELS` in `.env.local` (komma-gescheiden).

## Klaar voor een avatar

Het antwoord komt op één plek binnen, in `ask()` in `app/page.tsx`, als platte tekst zonder markdown:

```ts
const reply = await res.json();   // { text, articleId, mode, stories, live }
setTurns(...)                     // displayText(reply.text)
// later: avatar.speak(reply.text)
```

`components/AnchorStage.tsx` weet niets van artikelen of AI. Een realtime avatar zoals HeyGen LiveAvatar komt daar in de plaats van het "N"-gezicht en krijgt `text` als prop.

## Taalniveau

De vier snelle acties staan in `QUICK_ACTIONS` in `app/page.tsx`. Ze zijn gewone vragen, dus zowel de systeeminstructie in `lib/ai.ts` als de terugval in `lib/fallback.ts` herkent wat ze betekenen: makkelijker zeggen, uitleggen wat er gebeurd is (en wat moeilijke woorden betekenen), waarom het ertoe doet, en doorgaan naar het volgende bericht. De eerste drie gaan over het actieve onderwerp; is dat er nog niet, dan over bericht 1.

Nova schrijft voor jongeren en laaggeletterden, op eenvoudig Nederlands (ongeveer A2/B1). Ze gebruikt korte, actieve zinnen met één idee per zin. Moeilijke woorden, namen en instanties legt ze direct uit. De opening noemt maximaal 3 berichten van elk 2 zinnen. Extra context komt pas als je erom vraagt, en elk antwoord eindigt met één eenvoudige vraag. De regels staan in de systeeminstructie in `lib/ai.ts`.

## Grounding

- De systeeminstructie staat alleen op de server. Nieuwsfeiten mogen alleen uit de meegestuurde artikelen komen; nooit verzonnen nieuws, cijfers, citaten of bronnen.
- Staat iets niet in de artikelen, dan zegt Nova dat. Uitleg die niet uit het artikel komt, kondigt Nova aan als uitleg ("Ter uitleg: ...").
- Elk antwoord hoort bij hooguit één artikel (`articleId`), zodat de interface de juiste bron kan tonen.
- Er is geen websearch en geen tool. Het model heeft niets dan de artikeltekst.
- Het blijft een taalmodel. Het prompt verkleint de kans op verzinsels, maar sluit ze niet uit. Dat is iets om in de gebruikerstest te controleren.

## Terugval zonder Gemini

Ontbreekt de key, is Gemini niet bereikbaar (quotum, netwerk, time-out) of komt er geen bruikbare JSON terug, dan gebruikt `lib/ai.ts` de regelgebaseerde versie uit `lib/fallback.ts`. De interface meldt dat onderaan, en de echte fout staat in de terminal waar `npm run dev` draait (`[ai] Gemini niet gebruikt ...`). Zo valt een demo niet stil.

De terugval kiest zinnen uit het artikel; ze schrijft nooit iets bij. Daardoor kan ze geen feiten verzinnen, maar ook niet echt herschrijven. Om toch in de buurt van A2/B1 te blijven:

- hooguit drie zinnen en ongeveer 45 woorden per antwoord, het belangrijkste eerst;
- zinnen die zonder afkappen passen gaan voor; een lange bronzin wordt afgekapt bij een deelzin (komma voor een voegwoord of een puntkomma), en pas als laatste redmiddel bij een heel woord met een beletselteken;
- citaten vallen af zolang er gewone zinnen zijn: ze zijn meestal het langst en het moeilijkst;
- namen, getallen en feiten blijven staan zoals ze in de bron staan;
- staat het antwoord niet in het artikel, dan zegt Nova dat, in plaats van iets te kiezen dat er toevallig op lijkt. Naar een ander bericht springen mag alleen als twee woorden uit de vraag daar raken;
- elk antwoord eindigt, net als bij Gemini, met één eenvoudige vraag.

De opening van de terugval noemt dezelfde drie berichten als die van Gemini en geeft ook `articleId: null`, zodat de bronweergave in beide gevallen gelijk is. De terugval schrijft hoorbaar minder goed dan Gemini; dat is bewust zichtbaar in de interface.

## Bronnen in beeld

- **Lower third** in het beeld: bron, datum en link van het actieve verhaal.
- **Bronregel** onder het huidige antwoord, met link. Onder de opening staan de drie bronnen van de opening; daarna alleen de bron van het actieve verhaal.
- **"Bronnen"** (uitklapbaar): alle verhalen uit de feed met bron, datum, link en de tekst die Nova kreeg.
- **Regel onderaan:** of het nieuws live uit de NOS-feed komt of uit de demo-artikelen.

## Designkeuzes

- **Praten met een presentator, niet bladeren.** Er is geen artikelkeuze en er zijn geen nieuwskaarten. Bovenaan staat het beeld (16:9, plek voor de avatar), daaronder groot het huidige antwoord, dan snelle acties en het invoerveld. Het eerdere gesprek en de bronnen zitten in uitklapblokken.
- **Lower third als bronvermelding.** In tv-nieuws staat in die balk wie er spreekt en waarover. Hier staat Nova's naam naast bron en datum, dus de bron zit in het beeld zelf.
- **Palet.** Diep aubergine (#1B1633) voor het studiobeeld, lila-wit papier (#F2EFF7) voor de tekst, ultramarijn (#2B4FFF) voor alles wat klikbaar is, en rood (#FF3B5C) alleen voor het live-punt en foutmeldingen.
- **Typografie.** Bricolage Grotesque voor koppen, Schibsted Grotesk (ontworpen voor een nieuwsuitgever) voor lopende tekst en interface.
- **Beweging.** Alleen als reactie op een actie: de lower third schuift in bij een ander verhaal, de waveform beweegt terwijl Nova bezig is. `prefers-reduced-motion` zet beide uit.

## Volgende stappen

- Streaming response, zodat het antwoord meteen begint te lopen.
- Meer feeds (bijv. NOS Sport of Tech) en een slimmere selectie in `lib/news.ts`, bijvoorbeeld op wat jongeren raakt.
- Realtime avatar (HeyGen LiveAvatar) in `AnchorStage`, gevoed met `reply.text`.
- Gebruikerstest met jongeren: begrijpen ze dat Nova alleen deze artikelen kent, en vragen ze door?
