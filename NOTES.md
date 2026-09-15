# Werkafspraken Nova

Lees dit samen met de README. De README beschrijft wat er staat, dit bestand beschrijft hoe eraan gewerkt wordt.

## Context

Prototype voor de minor Digital Humans (sept 2026 - feb 2027). Opdracht: een AI virtual news anchor die jongeren van 16-24 dagelijks informeert, met een conversational interface en zichtbare bronnen. Beoordeling loopt via portfolio, dus keuzes moeten uit te leggen zijn — bij een wijziging in de architectuur of het design de reden hier of in de README bijschrijven.

Fase nu: nieuws- en chatflow werkend. Avatar komt later.

## Harde regels

- Nova gebruikt uitsluitend de tekst van het geselecteerde artikel. Geen websearch, geen tools, geen tweede artikel in dezelfde prompt.
- De system prompt en de API-key blijven server-side in `app/api/anchor/route.ts`. De client stuurt alleen `articleId` en de gespreksgeschiedenis.
- Wisselen van artikel wist de geschiedenis.
- De bron blijft zichtbaar zolang er een artikel actief is: lower third met bron, datum en link, plus de uitklap met de originele tekst.
- Staat een antwoord niet in het artikel, dan zegt Nova dat expliciet. Dat gedrag niet wegpoetsen om antwoorden vloeiender te maken.

## Codeconventies

- Lean. Geen abstracties die nog niks abstraheren, geen defensieve wrappers, geen helperlaag voor iets dat één keer voorkomt.
- State staat in `app/page.tsx`. Pas opsplitsen in componenten als dat bestand echt onleesbaar wordt, niet uit principe.
- Directe property access boven ketens van null-checks; alleen guarden waar iets echt kan ontbreken.
- CSS in `app/globals.css` met de tokens uit `:root`. Geen extra kleuren of radii introduceren zonder dat er een reden voor is.
- Code en identifiers in het Engels, teksten in de interface in het Nederlands.

## Designkeuzes die vastliggen

- Rundown links, studio rechts. Een verhaal kiezen = de uitzending start.
- Lower third als bronvermelding, niet als voetnoot onder de tekst.
- Beweging alleen als reactie op een actie, en `prefers-reduced-motion` blijft gerespecteerd.
- Geen decoratie die niets over de inhoud zegt.

## Volgende stappen

1. Streaming response, zodat het antwoord meteen begint te lopen.
2. Echte artikelen (RSS of redactie-API), tekst opschonen voordat die in de prompt gaat.
3. Text-to-speech op Nova's antwoord.
4. Avatar (Mascotte.AI) die op die audio beweegt. De waveform in het frame markeert die plek.
5. Gebruikerstest met jongeren: snappen ze dat Nova alleen dit artikel kent, en vragen ze door?

## Niet doen

- Geen extra dependencies zonder reden; nu alleen next, react, react-dom.
- Geen API-calls uitvoeren namens mij — geef het commando of de payload, ik run het en plak het resultaat terug.
- Geen echte bronnamen aan de verzonnen demo-artikelen hangen.
