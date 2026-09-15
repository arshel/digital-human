# Nova — AI virtual news anchor (prototype)

Webprototype voor de minoropdracht: een digitale nieuwspresentator voor jongeren. De app opent direct op de presentator. Nova haalt het actuele nieuws uit de NOS-feed, begroet je, noemt drie onderwerpen, en daarna vraag je door: meer uitleg, waarom het ertoe doet, wat het voor jongeren betekent, of het volgende onderwerp. Er is nog geen echte avatar.

## Starten

```bash
npm install
cp .env.example .env.local   # zet GEMINI_API_KEY erin
npm run dev
```

Open http://localhost:3000

## Structuur

```
lib/news.ts                  haalt de NOS-feed op (15 min cache), kiest drie verhalen, terugval op demo
data/articles.json           demo-artikelen voor als de feed niet bereikbaar is
lib/ai.ts                    AI-service: generateNewsResponse(), systeeminstructie, artikelcontext
lib/gemini.ts                het enige bestand dat Gemini kent (REST-aanroep, key uit .env.local)
lib/fallback.ts              regelgebaseerde terugval als Gemini ontbreekt of faalt
app/api/anchor/route.ts      serverroute, roept generateNewsResponse() aan
app/page.tsx                 gespreksstate, huidig antwoord, snelle acties, invoer, bronnen
components/AnchorStage.tsx   beeld van de presentator (plek voor de realtime avatar)
app/globals.css              designtokens en layout
```

## De flow

1. De pagina laadt en vraagt `/api/anchor` om een opening, met een lege gespreksgeschiedenis.
2. De server haalt de verhalen op via `getStories()` in `lib/news.ts`.
3. De server geeft Gemini de systeeminstructie, alle artikelen uit de feed (de drie voor de opening vooraan, genummerd, met id, bron, datum en volledige tekst) en het actieve onderwerp.
4. Gemini antwoordt in JSON: `{ text, articleId }`. `lib/ai.ts` controleert dat `articleId` echt een van de geladen artikelen is en voegt `mode` toe (`ai` of `fallback`).
5. De server stuurt ook de verhalen mee terug. De pagina toont `text` onder het beeld, zet het actieve artikel en laat de bron zien.
6. Bij elke vraag stuurt de pagina de hele geschiedenis, het actieve `articleId` en de ids van de verhalen mee. Zo snapt Gemini "die eerste", "dit" en "volgende onderwerp", en blijft het gesprek bij dezelfde drie verhalen, ook als de feed intussen ververst.

## Nieuws uit de NOS-feed

`lib/news.ts` haalt https://feeds.nos.nl/nosnieuwsalgemeen op de server op, zonder extra pakket. De XML wordt met een kleine eigen parser gelezen, met HTML naar platte alinea's.

- **Selectie:** de drie nieuwste berichten met minstens 400 tekens tekst, zodat er iets is om over door te vragen. Zijn dat er te weinig, dan vult het aan met kortere berichten.
- **Cache:** 15 minuten. Zo haalt niet elke vraag de feed opnieuw op, en verschuiven de verhalen niet midden in een gesprek.
- **Terugval:** is de feed niet bereikbaar (time-out na 6 s) of leeg, dan gebruikt Nova de demo-artikelen uit `data/articles.json`. De interface meldt dat. De fout staat in de terminal als `[news] NOS-feed niet gebruikt ...`, en na een minuut probeert de server het opnieuw.
- **Bron:** elk verhaal heeft "NOS" als bron en de link naar het echte artikel.
- **Grens:** Nova weet alleen wat in de feed staat. Bevat de feed maar een samenvatting, dan zegt Nova vaker dat ze iets niet weet. Volledige artikelen van nos.nl scrapen doen we bewust niet: dat breekt snel en het is hun content.

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

Nova schrijft voor jongeren en laaggeletterden, op eenvoudig Nederlands (ongeveer A2/B1). Ze gebruikt korte, actieve zinnen met één idee per zin. Moeilijke woorden, namen en instanties legt ze direct uit. De opening noemt maximaal 3 berichten van elk 2 zinnen. Extra context komt pas als je erom vraagt, en elk antwoord eindigt met één eenvoudige vraag. De regels staan in de systeeminstructie in `lib/ai.ts`.

## Grounding

- De systeeminstructie staat alleen op de server. Nieuwsfeiten mogen alleen uit de meegestuurde artikelen komen; nooit verzonnen nieuws, cijfers, citaten of bronnen.
- Staat iets niet in de artikelen, dan zegt Nova dat. Uitleg die niet uit het artikel komt, kondigt Nova aan als uitleg ("Ter uitleg: ...").
- Elk antwoord hoort bij hooguit één artikel (`articleId`), zodat de interface de juiste bron kan tonen.
- Er is geen websearch en geen tool. Het model heeft niets dan de artikeltekst.
- Het blijft een taalmodel. Het prompt verkleint de kans op verzinsels, maar sluit ze niet uit. Dat is iets om in de gebruikerstest te controleren.

## Terugval zonder Gemini

Ontbreekt de key, is Gemini niet bereikbaar (quotum, netwerk, time-out na 20 s) of komt er geen bruikbare JSON terug, dan gebruikt `lib/ai.ts` de regelgebaseerde versie uit `lib/fallback.ts`. Die antwoordt met letterlijke zinnen uit de artikelen. De interface meldt dat onderaan, en de echte fout staat in de terminal waar `npm run dev` draait (`[ai] Gemini niet gebruikt ...`). Zo valt een demo niet stil.

## Bronnen in beeld

- **Lower third** in het beeld: bron, datum en link van het actieve verhaal.
- **Bronregel** onder het huidige antwoord, met link. Onder de opening staan alle bronnen.
- **"Bronnen"** (uitklapbaar): de drie verhalen met bron, datum, link en de tekst die Nova kreeg.
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
