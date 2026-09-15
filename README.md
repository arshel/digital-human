# Nova — AI virtual news anchor (prototype)

Webprototype voor de minoropdracht: een digitale nieuwspresentator die jongeren drie verhalen per dag uitlegt en vervolgvragen beantwoordt. Deze versie heeft nog geen avatar; de nieuws- en chatflow staat centraal.

## Starten

```bash
npm install
cp .env.example .env.local   # vul ANTHROPIC_API_KEY in
npm run dev
```

Open http://localhost:3000

## Structuur

```
data/articles.json      3 artikelen (titel, bron, bronlink, datum, volledige tekst)
app/page.tsx            rundown links, studio rechts, chatstate
app/api/anchor/route.ts serverroute die het model aanroept
app/globals.css         designtokens en layout
```

## Hoe de grounding werkt

De volledige tekst van één artikel gaat in de system prompt van `/api/anchor`, samen met de regel dat alleen die tekst gebruikt mag worden. Staat een antwoord niet in het artikel, dan zegt Nova dat expliciet.

Twee dingen die dit afdwingen:

1. De API-key en de prompt staan alleen op de server. De client stuurt een `articleId` plus de gespreksgeschiedenis; hij kan de instructies niet aanpassen.
2. Er is geen websearch of andere tool aan de call gehangen. Het model heeft niets anders dan de artikeltekst.

Elke wisseling van artikel wist de geschiedenis, zodat informatie uit verhaal 1 niet in verhaal 2 terechtkomt.

De bron blijft zichtbaar via de lower third (de balk zoals bij tv-nieuws) en via "Lees het artikel zelf", waarin de originele tekst staat die het model ook kreeg.

## Designkeuzes

- **Rundown en studio.** De linkerkolom is de uitzendlijst, de rechterkolom de studio. Een verhaal kiezen betekent: de uitzending begint.
- **Lower third als bronvermelding.** In tv-nieuws staat in die balk wie er spreekt en waarover. Hier staat Nova's naam naast bron en datum, dus de bron zit in het beeldframe zelf en niet in een voetnoot.
- **Palet.** Diep aubergine (#1B1633) voor het studiobeeld, lila-wit papier (#F2EFF7) voor de tekst, ultramarijn (#2B4FFF) voor alles wat klikbaar is, en rood (#FF3B5C) alleen voor het live-punt en foutmeldingen.
- **Typografie.** Bricolage Grotesque voor koppen, Schibsted Grotesk (ontworpen voor een nieuwsuitgever) voor lopende tekst en interface.
- **Beweging.** Alleen als reactie op een actie: de lower third schuift in bij een nieuw verhaal, de waveform beweegt terwijl Nova antwoordt. `prefers-reduced-motion` zet beide uit.

## Volgende stappen

- Echte artikelen inlezen (RSS of een redactie-API) en de tekst opschonen voordat die in de prompt gaat.
- Streaming response, zodat het antwoord meteen begint te lopen.
- Text-to-speech op het antwoord van Nova, daarna pas een avatar (bijvoorbeeld de Mascotte.AI-avatar) die op die audio beweegt.
- Gebruikerstest met jongeren: begrijpen ze dat Nova alleen dit artikel kent, en vragen ze door?
