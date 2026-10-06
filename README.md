# Nova — AI virtual news anchor (prototype)

Webprototype voor de minoropdracht: een digitale nieuwspresentator die het nieuws begrijpelijk uitlegt aan laaggeletterde 18–24-jarigen. De app opent op de presentator en begint pas als je op "Start nieuws" drukt. Dan haalt Nova het actuele nieuws uit de NOS-feed, begroet je en noemt drie onderwerpen. Daarna kies je "Volgende onderwerp", vraag je via "Extra uitleg" om "Leg het makkelijker uit", "Wat betekent dit?", "Waarom is dit belangrijk?" of "Opnieuw uitleggen", typ je zelf een vraag ("Stel een vraag"), of kies je een onderwerp uit "Ander nieuws". Je leest mee in de ondertiteling over het beeld. De avatar (LiveAvatar) toont beeld, maar Nova spreekt nog niet.

## Starten

```bash
npm install
cp .env.local.example .env.local   # zet GEMINI_API_KEY en LIVEAVATAR_API_KEY erin
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
app/api/liveavatar/token/route.ts  sessietoken voor LiveAvatar (API-key blijft server-side)
app/page.tsx                 gespreksstate, ondertiteling, bediening, panelen en bronnen
components/AnchorStage.tsx   beeld van de presentator (LiveAvatar), past de video in zonder het gezicht te bedekken
components/Panel.tsx         paneel als <dialog>: focus erin, Escape sluit, focus terug; op de telefoon een blad onderin
components/useReadAlong.ts   meelezen: antwoord in stukjes van hooguit twee regels, elke zin op een eigen regel
components/icons.tsx         pictogrammen (altijd naast tekst)
app/globals.css              designtokens en layout
```

## De flow

1. De gebruiker drukt op "Start nieuws". Pas dan vraagt de pagina `/api/anchor` om een opening (met een lege gespreksgeschiedenis) en start de avatarsessie. Bij het laden van de pagina gebeurt nog niets.
2. De route valideert de aanvraag (zie "Grenzen aan de API") en haalt de verhalen op via `getStories()` in `lib/news.ts`.
3. De server geeft Gemini de systeeminstructie, een begrensde selectie artikelen (genummerd, met id, bron, datum en tekst) en het actieve onderwerp.
4. Gemini antwoordt in JSON: `{ text, articleId }`. `lib/ai.ts` controleert dat `articleId` echt een van de geladen artikelen is en voegt `mode` toe (`ai` of `fallback`).
5. De server stuurt ook de verhalen mee terug. De pagina toont `text` als ondertiteling over het beeld, zet het actieve artikel en laat de bron zien. Is `live` false (demo-artikelen), dan toont de pagina die niet; zie "Bronnen in beeld".
6. Bij elke vraag stuurt de pagina de geschiedenis, het actieve `articleId` en de ids van de verhalen mee — nooit artikeltekst. Zo snapt Gemini "die eerste", "dit" en "volgende onderwerp", en blijft het gesprek bij dezelfde verhalen in dezelfde volgorde, ook als de feed intussen ververst.

### De opening: precies drie verhalen

De opening noemt bewust drie berichten van elk hooguit twee zinnen. Meer is voor de doelgroep (laaggeletterde 18–24-jarigen) te veel om te onthouden, en het houdt de uitzending kort. Het getal staat als `OPENING_COUNT` in `lib/news.ts`; `getStories()` zet die drie vooraan.

Na de opening zit de gebruiker niet vast aan die drie. De rest van de feed staat erachter, dus "volgende onderwerp" loopt door naar bericht 4, 5 enzovoort, en een vraag over ander nieuws wordt gewoon beantwoord. Er staat expres geen onderwerpenteller in de interface: Nova is een presentator, geen lijst.

De opening hoort bij geen enkel artikel, dus `articleId` is dan `null` — ook in de terugval. De interface toont daardoor de drie bronnen van de opening, en bovenin staat "Het nieuws van vandaag". Elk volgend antwoord hoort bij één artikel en toont alleen die bron.

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
- Het model is `gemini-3.1-flash-lite`. Dat staat vooraan en doet in normale omstandigheden al het werk, zodat het taalniveau en de toon gelijk blijven.
- Is dat model op (gratis quotum, 429) of overbelast (503), dan probeert de app `gemini-3.6-flash`, `gemini-3.8-flash` en `gemini-3.5-flash`. Elk model heeft een eigen quotum, dus een demo valt niet stil door één vol model. Een model dat faalt gaat even in de wacht: na een 429 minstens een minuut, na een 503 dertig seconden.
- Voor een gebruikerstest is dat een afweging. Antwoorden van een ander model klinken anders, en dat zie je niet in de interface, want `mode` blijft `ai`. Wil je zeker weten dat alle deelnemers dezelfde Nova kregen, zet dan `GEMINI_MODELS=gemini-3.1-flash-lite` in `.env.local` voor de duur van de test en kijk achteraf in de terminal of er is teruggevallen.
- Een eigen lijst zet je met `GEMINI_MODELS` (komma-gescheiden, in volgorde van voorkeur). Lukt geen enkel model, dan volgt de regelgebaseerde terugval uit `lib/fallback.ts` en meldt de interface dat.
- **Wachttijden:** een model krijgt 20 seconden, alle pogingen samen 30. Stond eerder op 10 en 25, maar dan kapte de app een traag antwoord van Google er zelf uit en telde dat als mislukt. Bij een trage eerste poging blijft er tijd over voor één ander model, niet meer. Een gebruiker kan dus in het slechtste geval een halve minuut wachten; dat is bewust, want de regelgebaseerde terugval schrijft hoorbaar slechter. Streaming moet die wachttijd later opvangen.

## Klaar voor een avatar

Het antwoord komt op één plek binnen, in `ask()` in `app/page.tsx`, als platte tekst zonder markdown:

```ts
const reply = await res.json();   // { text, articleId, mode, stories, live }
setTurns(...)                     // { role: 'assistant', content: reply.text, articleId }
// later: avatar.speak(reply.text)
```

`components/AnchorStage.tsx` weet niets van artikelen of AI: het krijgt alleen een startverzoek (`startRequest`) en de plekken waar tekst en knoppen over het beeld liggen (`keepClear`), en meldt zijn status terug. De avatarvideo staat er in de plaats van het "N"-gezicht zodra de sessie loopt; later krijgt het ook `text` om uit te spreken.

### Avatar-zichttest (LiveAvatar)

"Start nieuws" start ook een LiveAvatar-sessie en zet het avatarbeeld schermvullend in beeld, nooit vanzelf bij het laden. Dit is nog steeds een zichttest: geen microfoon, geen spraak, geen tekst-naar-spraak en geen koppeling met Gemini. De avatar staat stil te wachten. De nieuwsflow blijft er los van.

- **LITE-modus**, want wij leveren later zelf de audio; LiveAvatar rendert alleen het beeld.
- **Sandbox aan** (`is_sandbox: true`): kost geen credits, en de sessie stopt na ongeveer een minuut vanzelf. De avatar is Wayne (`dd73ea75-1218-4ef3-92ce-606d5f7fbc0a`), de enige sandbox-avatar.
- **Andere avatar** met `LIVEAVATAR_AVATAR_ID` in `.env.local` (een ID zonder streepjes, zoals uit HeyGen, wordt omgezet naar de UUID-vorm die LiveAvatar verwacht). Dat kan niet in de sandbox en kost credits: LITE 1 credit per minuut; het gratis abonnement geeft 10 credits per maand en kan niet bijbetalen. Een eigen (niet-standaard) avatar vraagt bij LiveAvatar een betaald abonnement. Daarom: hooguit 3 minuten per sessie (`max_session_duration`), en de sessie stopt zodra het tabblad niet zichtbaar is. Controleren of een ID in LiveAvatar bestaat: `GET https://api.liveavatar.com/v1/avatars/{id}` met de header `X-API-KEY`.
- **De key blijft op de server.** `app/api/liveavatar/token/route.ts` roept `POST https://api.liveavatar.com/v1/sessions/token` aan met de header `X-API-KEY` en geeft de browser alleen het kortlevende `session_token` terug. Geen `NEXT_PUBLIC_`-variabele, en de key staat nergens in de logs.
- **De browser** laadt `@heygen/liveavatar-web-sdk` pas na de klik (dynamische import, dus niet in de eerste bundel), maakt `new LiveAvatarSession(sessionToken)` en roept `start()` aan. De SDK doet daarmee zelf `POST /v1/sessions/start` en verbindt met de LiveKit-room. Bij `SESSION_STREAM_READY` gaat de stream met `attach()` in het `<video>`-element.
- **Geen microfoon.** De SDK start voice chat alleen als je `voiceChat` meegeeft in de config. Dat doen we niet, dus de browser vraagt geen toestemming.
- **Statussen** in beeld: "Het beeld van de presentator start…", "De presentator werkt nu niet" (met "Probeer het opnieuw") en "Het beeld is gestopt" (de sandbox stopt na een minuut; met "Start het beeld opnieuw"). Een nieuwe sessie start alleen na zo'n klik. Komt er binnen 15 seconden geen beeld, dan stopt de sessie en verschijnt de foutmelding. Het verlaten van de pagina sluit de sessie af.
- **Wat de SDK kan** (gecontroleerd in `@heygen/liveavatar-web-sdk` 0.0.19): `repeat(tekst)` laat de avatar tekst uitspreken, maar alleen in FULL-modus; in LITE-modus spreekt de avatar alleen audio die je zelf aanlevert (`repeatAudio`, PCM 24 kHz). Pauzeren en hervatten bestaan niet, alleen `interrupt()` (stoppen). Events voor ondertiteling: `AVATAR_SPEAK_STARTED`/`ENDED` en `AVATAR_TRANSCRIPTION`. Daarom heeft de interface nu geen pauzeknop en geen microfoonknop: er is nog geen geluid om te pauzeren.
- **Beeld zonder bedekt gezicht.** De video houdt altijd zijn eigen verhouding (16:9, niet uitgerekt). `AnchorStage` rekent uit hoe groot hij mag, zodat het onderwerp bovenin en de ondertiteling en knoppen onderin buiten het gezicht blijven. Het gezicht van Wayne is gemeten op de echte stream (haar vanaf ~10%, kin tot ~62% van de beeldhoogte); een andere avatar moet je opnieuw meten (`FACE` in `AnchorStage.tsx`). Naast de video staat één stilstaand, vervaagd beeld van de randen van het decor, zodat het beeld zonder naad doorloopt.

## Taalniveau

De vier vervolgvragen onder "Extra uitleg" staan in `EXPLAIN` in `app/page.tsx`; "Volgende onderwerp" is een vaste knop. Het zijn gewone vragen, dus zowel de systeeminstructie in `lib/ai.ts` als de terugval in `lib/fallback.ts` herkent wat ze betekenen: makkelijker zeggen, uitleggen wat er gebeurd is (en wat moeilijke woorden betekenen), waarom het ertoe doet, het nog eens anders uitleggen, en doorgaan naar het volgende bericht. Ze gaan over het actieve onderwerp; is dat er nog niet, dan over bericht 1. Een keuze uit "Ander nieuws" stuurt "Vertel over onderwerp N." met dat artikel als actief, zodat de volledige tekst erbij zit.

Nova schrijft voor laaggeletterde jongvolwassenen van 18 tot en met 24 jaar. Waarom die leeftijd staat in ons doelgroeponderzoek (`Doelgroeponderzoek_virtual_newsfluencer.docx`). Bij 66–75-jarigen komt lage taalvaardigheid vaker voor, en 25–44-jarigen zijn digitaal het vaardigst. Jongvolwassenen willen vaker betere uitleg en eenvoudiger taal, en volgen nieuws al via platforms en online makers. Daarom passen ze het best bij een digitale presentator. Het is een praktische keuze voor het prototype, geen bewezen grens: 25–44 is vergelijkingsgroep in de test. Ze schrijft in eenvoudig Nederlands, met A2 als uitgangspunt: B1 is voor veel gebruikers nog te moeilijk. Ze gebruikt korte, actieve zinnen (streven: hooguit 10 woorden, wel natuurlijke spreektaal) met één idee per zin. Ze gebruikt steeds hetzelfde woord voor hetzelfde begrip, vermijdt spreekwoorden en beeldspraak, en vermijdt afkortingen (of legt ze direct uit). Moeilijke woorden, namen en instanties legt ze direct uit. Eenvoudig, maar niet kinderachtig, en zonder overdreven jongerentaal. Omdat de tekst later wordt uitgesproken: natuurlijke zinnen, geen markdown, opsommingen of emoji.

De opening noemt maximaal 3 berichten van elk 2 zinnen en eindigt met één eenvoudige vraag. Een gewoon antwoord is twee tot vier korte zinnen: eerst de belangrijkste boodschap, dan direct de achtergrond die nodig is om die te begrijpen. Verdieping komt pas als je erom vraagt. Een afsluitende vraag alleen als dat helpt om verder te gaan: de knoppen bieden al vervolgkeuzes, dus Nova noemt die niet steeds opnieuw.

Nova geeft geen eigen mening en stuurt de mening van de gebruiker niet. Ze doet niet alsof ze een menselijke journalist is. Gevoelige onderwerpen (oorlog, geweld, criminaliteit, gezondheid, overlijden) behandelt ze rustig en feitelijk, zonder schokkende details en zonder medische, juridische of financiële conclusies voor de gebruiker.

De regels staan in de systeeminstructie in `lib/ai.ts`, in blokken per onderwerp en per snelle actie.

## Grounding

- De systeeminstructie staat alleen op de server. Nieuwsfeiten mogen alleen uit de meegestuurde artikelen komen; nooit verzonnen nieuws, cijfers, citaten of bronnen.
- Staat iets niet in de artikelen, dan zegt Nova dat. Uitleg die niet uit het artikel komt, kondigt Nova aan als uitleg ("Ter uitleg: ...").
- Nuance blijft staan: feiten, verwachtingen en meningen uit elkaar, twijfel uit het bericht niet weglaten, een beschuldiging nooit als bewezen feit, en tegenstrijdige berichten benoemen.
- De tekst van een nieuwsbericht is alleen informatie. Staan er instructies in, dan volgt Nova die niet.
- Elk antwoord hoort bij hooguit één artikel (`articleId`), zodat de interface de juiste bron kan tonen. Is niet duidelijk welk onderwerp bedoeld wordt, dan stelt Nova één korte verduidelijkende vraag.
- Er is geen websearch en geen tool. Het model heeft niets dan de artikeltekst.
- Het blijft een taalmodel. Het prompt verkleint de kans op verzinsels, maar sluit ze niet uit. Dat is iets om in de gebruikerstest te controleren.

## Terugval zonder Gemini

Ontbreekt de key, is Gemini niet bereikbaar (quotum, netwerk, time-out) of komt er geen bruikbare JSON terug, dan gebruikt `lib/ai.ts` de regelgebaseerde versie uit `lib/fallback.ts`. De interface meldt dat bovenin bij het onderwerp, en de echte fout staat in de terminal waar `npm run dev` draait (`[ai] Gemini niet gebruikt ...`). Zo valt een demo niet stil.

De terugval kiest zinnen uit het artikel; ze schrijft nooit iets bij. Daardoor kan ze geen feiten verzinnen, maar ook niet echt herschrijven. Om toch in de buurt van A2 te blijven:

- hooguit drie zinnen en ongeveer 45 woorden per antwoord, het belangrijkste eerst;
- zinnen die zonder afkappen passen gaan voor; een lange bronzin wordt afgekapt bij een deelzin (komma voor een voegwoord of een puntkomma), en pas als laatste redmiddel bij een heel woord met een beletselteken;
- citaten vallen af zolang er gewone zinnen zijn: ze zijn meestal het langst en het moeilijkst;
- namen, getallen en feiten blijven staan zoals ze in de bron staan;
- staat het antwoord niet in het artikel, dan zegt Nova dat, in plaats van iets te kiezen dat er toevallig op lijkt. Naar een ander bericht springen mag alleen als twee woorden uit de vraag daar raken;
- elk antwoord eindigt met een vaste, eenvoudige vraag (Gemini doet dat alleen als het helpt).

De terugval herkent ook "Opnieuw uitleggen" (dan de kern van het bericht nog eens) en "Vertel over onderwerp 12" uit de lijst "Ander nieuws".

De opening van de terugval noemt dezelfde drie berichten als die van Gemini en geeft ook `articleId: null`, zodat de bronweergave in beide gevallen gelijk is. De terugval schrijft hoorbaar minder goed dan Gemini; dat is bewust zichtbaar in de interface.

## Bronnen in beeld

- **Onderwerp bovenin:** de titel van het actieve bericht, met "AI-presentator" erboven.
- **"Bekijk de bron"** onder de knoppen: opent bron, publicatiedatum en de link naar het oorspronkelijke bericht. Bij de opening zijn dat de drie berichten van de opening; daarna alleen het actieve verhaal. Niets wordt aangevuld: ontbreekt een tijd, dan staat er alleen een datum.
- **Geen voorbeeldnieuws.** Is de NOS-feed niet bereikbaar, dan stuurt de server demo-artikelen met verzonnen bronnen mee (`live: false`). Deze interface toont die niet, maar meldt dat de nieuwsbron niet bereikbaar is, met "Opnieuw proberen".
- **"Hoe werkt dit?"** legt uit dat Nova een AI-presentator is, dat het nieuws uit de NOS-feed komt maar Nova geen dienst van de NOS is, dat AI fouten kan maken en dat Nova nog niet spreekt.

## Designkeuzes

Op de branch `design-preview`; `main` heeft nog het vorige ontwerp.

- **De presentator vult het scherm.** Onder een smalle bovenbalk (Nova, "Nieuws met uitleg", "Ander nieuws", "Hoe werkt dit?") staat het beeld. Linksboven het onderwerp, onderin de ondertiteling, drie grote knoppen ("Stel een vraag", "Extra uitleg", "Volgende onderwerp") en "Bekijk de bron". Altijd op dezelfde plek. Geen kaarten, zijbalk of chatvenster.
- **Zelf starten.** Bij het laden gebeurt niets; "Start nieuws" is de enige actie. Pas dan gaan de eerste vraag naar Gemini en de avatarsessie van start.
- **Leesbaarheid** (richtlijnen van Stichting Lezen en Schrijven): Verdana (anders Helvetica of Arial), nergens kleiner dan 16 px, regelafstand 1,5, tekst links uitgelijnd, zwart op wit. De ondertiteling staat op een wit, dekkend vlak met zwarte tekst. In uitlegtekst staat elke zin op een eigen regel, en de belangrijkste informatie is vet: bij een antwoord de eerste zin, omdat Nova met de belangrijkste boodschap begint.
- **Meelezen zonder nep-timing.** Nova spreekt nog niet, dus er is geen echte koppeling tussen tekst en geluid. De tekst staat in stukjes van hooguit twee regels (gemeten op de echte breedte en letter) en de lezer bladert zelf met "Terug" en "Verder".
- **Panelen** voor "Extra uitleg", "Stel een vraag", "Ander nieuws", "Hoe werkt dit?" en de bron: native `<dialog>`, met Escape en "Sluiten", en de focus gaat terug naar de knop die het opende. Op de telefoon een blad vanaf de onderkant dat boven het schermtoetsenbord blijft.
- **Kleur.** Zwart op wit voor alle tekst, donkerblauw (#102A5C) alleen voor de belangrijkste actie ("Start nieuws", "Extra uitleg"), een rustige warmgrijze achtergrond achter de presentator.
- **Beweging.** Geen decoratieve animatie en geen bewegende achtergrond; alleen een rustig knipperend puntje terwijl Nova een antwoord maakt, en `prefers-reduced-motion` zet dat uit.
- **Telefoon.** Hetzelfde ontwerp: de presentator wordt zo nodig kleiner, zodat ondertiteling en knoppen onderin binnen bereik van de duim blijven. Veilige schermranden en het schermtoetsenbord zijn meegenomen.

## Volgende stappen

- Streaming response, zodat het antwoord meteen begint te lopen.
- Meer feeds (bijv. NOS Sport of Tech) en een slimmere selectie in `lib/news.ts`, bijvoorbeeld op wat jongeren raakt.
- Avatar laten spreken: eigen TTS-audio (PCM 24 kHz) naar de LiveAvatar-sessie (LITE, `repeatAudio`), gevoed met `reply.text`, en daarna uit de sandbox. Het spreektempo stel je dan in bij die TTS. Pas dan horen er een knop "Pauze/Verder luisteren" en ondertiteling met echte timing bij; de SDK kan alleen stoppen (`interrupt()`), dus "verder luisteren" betekent dan het resterende deel opnieuw sturen.
- Vergelijkende gebruikerstest met mensen met leesproblemen uit meerdere leeftijdsgroepen, met 25–44 als belangrijkste vergelijking. Ze krijgen dezelfde onderwerpen, met en zonder avatar. Meten: begrip (de kern navertellen), benodigde hulp, of ze terugkomen, en of ze de rol van AI en de bronnen begrijpen.
