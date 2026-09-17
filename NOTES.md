# Werkafspraken Nova

Lees dit samen met de README. De README beschrijft wat er staat, dit bestand beschrijft hoe eraan gewerkt wordt.

## Context

Prototype voor de minor Digital Humans (sept 2026 - feb 2027). Opdracht: een AI virtual news anchor die jongeren van 16-24 dagelijks informeert, met een conversational interface en zichtbare bronnen. Beoordeling loopt via portfolio, dus keuzes moeten uit te leggen zijn — bij een wijziging in de architectuur of het design de reden hier of in de README bijschrijven.

Fase nu: nieuws- en chatflow werkend op Gemini (free tier) met live nieuws uit de NOS-feed; terugval op regels en demo-artikelen. Avatar komt later.

## Harde regels

- Nova gebruikt voor nieuwsfeiten uitsluitend de tekst van de geladen artikelen. Geen websearch, geen tools, geen eigen kennis over actualiteit. Uitleg mag, maar als uitleg aangekondigd.
- Elk antwoord hoort bij hooguit één artikel en meldt welk (`articleId`). Alleen de opening gaat over alle verhalen.
- Systeeminstructie en `GEMINI_API_KEY` blijven server-side (`lib/ai.ts`, `lib/gemini.ts`). De client stuurt alleen de gespreksgeschiedenis en het actieve `articleId`.
- Bronnen blijven zichtbaar: lower third voor het actieve verhaal, een bronregel onder het huidige antwoord, en de uitklap "Bronnen" met de originele tekst. Bij de opening (`articleId: null`) zijn dat de drie bronnen van de opening.
- Staat een antwoord niet in de artikelen, dan zegt Nova dat expliciet. Dat gedrag niet wegpoetsen om antwoorden vloeiender te maken.
- De app praat alleen met `generateNewsResponse()` in `lib/ai.ts`, nooit direct met Gemini. Alleen `lib/gemini.ts` kent de provider.
- AI-logica en avatar blijven los van elkaar. De avatar krijgt tekst en bron binnen, maar weet niets van artikelen of het model.

Gewijzigd op 15 sept 2026: de app opent nu direct op de presentator in plaats van op een artikelkeuze. De oude regels "één artikel per prompt" en "wisselen wist de geschiedenis" zijn vervallen: het gesprek loopt door over drie verhalen, zoals een echte uitzending. Om bronvermenging te voorkomen hoort nu elk antwoord bij hooguit één artikel.

Gewijzigd op 15 sept 2026: Gemini (REST via `fetch`, geen SDK-dependency) vervangt de regelgebaseerde logica. Die blijft als terugval in `lib/fallback.ts`, omdat een free tier kan haperen en een demo niet stil mag vallen. De interface meldt het als de terugval actief is.

Gewijzigd op 15 sept 2026: het nieuws komt live uit https://feeds.nos.nl/nosnieuwsalgemeen (`lib/news.ts`). De demo-artikelen blijven als terugval. De client stuurt de ids van de verhalen mee, geen artikeltekst, zodat de server de inhoud bepaalt en een gesprek bij dezelfde verhalen blijft. Geen scraping van volledige artikelen.

Gewijzigd op 15 sept 2026: doelgroep uitgebreid naar jongeren én laaggeletterden. Nova schrijft op A2/B1-niveau: korte actieve zinnen, één idee per zin, moeilijke woorden en instanties direct uitgelegd, opening maximaal 3 berichten van elk 2 zinnen, elk antwoord eindigt met één eenvoudige vraag. Namen en instanties uitleggen mag uit algemene kennis; nieuwsfeiten blijven alleen uit de berichten.

Gewijzigd op 17 sept 2026: de opening blijft bewust precies drie berichten — dat is de introductie die we goed vinden werken — maar Nova heeft daarna de hele feed. "Volgende onderwerp" loopt door voorbij bericht 3. Geen onderwerpenteller in de interface: dit is een uitzending, geen lijst.

Gewijzigd op 17 sept 2026: de opening hoort bij geen enkel artikel, dus `articleId` is `null`, ook in de terugval. Daardoor toont de interface de drie bronnen van de opening en blijft de lower third algemeen; elk volgend antwoord hoort bij één artikel en toont één bron. Eerder gaf de terugval het id van alleen het eerste verhaal, waardoor er één bron bij drie verhalen stond.

Gewijzigd op 17 sept 2026: de context naar Gemini is begrensd (hooguit 15 berichten, korte tekst voor niet-actieve berichten, laatste ~11 beurten). Reden: elke vraag stuurt alles opnieuw mee, en het gratis quotum is klein. Het actieve bericht en zijn opvolger zitten er altijd in, zodat verwijzingen en "volgende onderwerp" blijven werken.

Gewijzigd op 17 sept 2026: `/api/anchor` valideert de body (`unknown` tot bewezen goed) en heeft een rate limit van 20 per minuut per IP, in het geheugen van het proces. Bewust geen pakket erbij. Voor echte productie is dit te weinig: dan een gedeelde teller (Upstash) of de rate limit van het platform.

Gewijzigd op 17 sept 2026: de terugval kort bronzinnen in en kiest gewone zinnen boven citaten, zodat het taalniveau niet instort als Gemini wegvalt. Ze schrijft nog steeds niets bij: elk woord komt uit het artikel. Kan ze het antwoord niet vinden, dan zegt ze dat.

## Codeconventies

- Lean. Geen abstracties die nog niks abstraheren, geen defensieve wrappers, geen helperlaag voor iets dat één keer voorkomt.
- State staat in `app/page.tsx`. Pas opsplitsen in componenten als dat bestand echt onleesbaar wordt, niet uit principe. Uitzondering: `components/AnchorStage.tsx`, omdat daar de echte avatar (HeyGen LiveAvatar) in komt.
- Directe property access boven ketens van null-checks; alleen guarden waar iets echt kan ontbreken.
- CSS in `app/globals.css` met de tokens uit `:root`. Geen extra kleuren of radii introduceren zonder dat er een reden voor is.
- Code en identifiers in het Engels, teksten in de interface in het Nederlands.

## Designkeuzes die vastliggen

- De presentator staat centraal, de uitzending start bij het laden. Geen keuzescherm en geen nieuwskaarten: beeld, huidig antwoord, snelle acties, invoer. Gesprek en bronnen in uitklapblokken.
- Lower third als bronvermelding, niet als voetnoot onder de tekst.
- Beweging alleen als reactie op een actie, en `prefers-reduced-motion` blijft gerespecteerd.
- Geen decoratie die niets over de inhoud zegt.

## Volgende stappen

1. Streaming response, zodat het antwoord meteen begint te lopen.
2. Echte artikelen (RSS of redactie-API), tekst opschonen voordat die in de prompt gaat.
3. Realtime avatar (HeyGen LiveAvatar) in `components/AnchorStage.tsx`, gevoed met `reply.text`.
4. Gebruikerstest met jongeren: snappen ze dat Nova alleen deze artikelen kent, en vragen ze door?

## Niet doen

- Geen extra dependencies zonder reden; nu alleen next, react, react-dom. Kwetsbaarheden oplossen met de kleinste veilige stap: `postcss` staat in `overrides` op ^8.5.28 omdat Next 15.5.25 8.4.31 pint. Niet blind `npm audit fix --force`, dat trekt Next naar een nieuwe major.
- Geen API-calls uitvoeren namens mij — geef het commando of de payload, ik run het en plak het resultaat terug.
- Geen echte bronnamen aan de verzonnen demo-artikelen hangen. Echte bronnaam (NOS) alleen bij berichten die echt uit de feed komen.
