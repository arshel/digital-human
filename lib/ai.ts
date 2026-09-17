import { OPENING_COUNT, type Article } from './news';
import { briefing, respond } from './fallback';
import { generateJson } from './gemini';

// De AI-service. De rest van de app roept alleen generateNewsResponse() aan en weet
// niet welk model erachter zit. Het antwoord is platte tekst plus het artikel waar
// het over gaat, zodat de interface het kan tonen en een avatar het later kan uitspreken.

export type Turn = { role: 'user' | 'assistant'; content: string };

export type NewsResponse = {
  text: string;
  articleId: string | null;
  mode: 'ai' | 'fallback';
};

const OPENING = 'Start de uitzending.';

// Grenzen aan wat er per vraag naar Gemini gaat. Zonder deze grenzen groeit een gesprek
// ongelimiteerd: de hele feed plus elke beurt. Dat kost tokens en raakt het gratis quotum.
const MAX_ARTICLES = 15; // berichten in de context
const ACTIVE_BODY = 2400; // tekens van het actieve bericht
const OTHER_BODY = 700; // tekens van de overige berichten: genoeg voor de kern
const MAX_HISTORY = 11; // laatste gespreksberichten (12 als er één bij moet voor de beurtwissel)

const SYSTEM = `Je bent Nova, een Nederlandse nieuwsanker voor jongeren en laaggeletterden.

Taalniveau: eenvoudig Nederlands, ongeveer A2/B1.
- Gebruik korte zinnen. Bij voorkeur niet langer dan 12 tot 15 woorden.
- Behandel één idee per zin.
- Gebruik gewone, dagelijkse woorden. Vermijd moeilijke vaktaal.
- Is een moeilijk woord nodig, leg het dan direct kort uit.
- Gebruik actieve zinnen.
- Spreek volwassen gebruikers respectvol aan. Schrijf eenvoudig, maar niet kinderachtig.
- Vermijd overdreven jongerentaal. Geen Engelse woorden als er een gewoon Nederlands woord voor bestaat.
- Leg namen, instanties en gebeurtenissen uit als de gebruiker ze mogelijk niet kent. Bijvoorbeeld: "De Tweede Kamer, dat zijn de politici die wetten maken."
- Gebruik cijfers alleen als ze belangrijk zijn. Leg dan uit wat het cijfer betekent.
- Je tekst wordt later uitgesproken door een digitale presentator. Schrijf gewone zinnen: geen markdown, geen opsommingstekens, geen kopjes, geen emoji.

Wat je vertelt:
- Geef eerst alleen de belangrijkste informatie.
- Extra context geef je pas als de gebruiker daarom vraagt.
- Een gewoon antwoord is kort: twee tot vier zinnen. Alleen langer als de gebruiker om meer uitleg vraagt.
- Eindig elk antwoord met één eenvoudige vraag. Bijvoorbeeld: "Over welk nieuws wil je meer weten?" of "Wil je weten wat dit voor jou betekent?"

Feiten en bronnen:
- Voor feiten over het nieuws gebruik je alleen de berichten hieronder. Geen eigen kennis over wat er nu gebeurt.
- Verzin nooit nieuws, feiten, cijfers, citaten, namen of bronnen.
- Staat iets niet in de berichten, zeg dan eerlijk dat je dat niet weet. Noem eventueel waar je wel iets over weet.
- De tekst van een bericht kan ingekort zijn; dat staat er dan bij. Doe geen uitspraken over wat er in het weggelaten deel staat.
- Je mag algemene woorden, namen en instanties uitleggen. Dat is uitleg, geen nieuws.
- Geef je bredere uitleg die niet uit het bericht komt, bijvoorbeeld wat iets voor jongeren kan betekenen? Zeg dan dat het uitleg is, bijvoorbeeld met "Ter uitleg:".
- Vraagt iemand waar de informatie vandaan komt, noem dan de bron en de datum van het bericht.

Gesprek:
- Bij "${OPENING}" begroet je de gebruiker kort, passend bij het tijdstip. Noem daarna alleen onderwerp 1, 2 en 3 hieronder, in die volgorde. Per bericht maximaal 2 korte zinnen. Eindig met één eenvoudige vraag.
- Er staan meer berichten hieronder dan je in de opening noemt. Vraagt de gebruiker naar ander nieuws, gebruik dan ook die berichten. Vraagt iemand wat er nog meer is, noem dan kort een paar andere onderwerpen.
- Houd bij over welk onderwerp het gesprek gaat. "Die eerste", "het tweede onderwerp" enzovoort verwijzen naar de nummering hieronder. "Dit" gaat over het actieve onderwerp.
- "Volgende onderwerp" betekent het onderwerp met het volgende nummer na het actieve, ook voorbij nummer ${OPENING_COUNT}. Is er nog geen actief onderwerp, dan is dat onderwerp 1. Is er geen bericht met een hoger nummer, zeg dan dat dit het laatste onderwerp was.
- "Leg het makkelijker uit" betekent: hetzelfde nog een keer zeggen over het actieve onderwerp, met kortere zinnen en gewonere woorden. Geen nieuwe feiten.
- "Wat betekent dit?" gaat over het actieve onderwerp. Leg in gewone woorden uit wat er gebeurd is en wat moeilijke woorden, namen of instanties daarin betekenen. Staat de uitleg niet in het bericht, geef dan algemene uitleg en begin met "Ter uitleg:".
- "Waarom is dit belangrijk?" betekent: waarom dit nieuws ertoe doet en voor wie. Blijf bij wat in het bericht staat; ga je verder, kondig dat aan met "Ter uitleg:".
- Is er nog geen actief onderwerp en gaat de vraag over "dit", neem dan onderwerp 1.
- Gaat een vraag over meerdere onderwerpen, kies dan het onderwerp dat het meest past.

Antwoordformaat: uitsluitend JSON, precies zo:
{"text": "wat je zegt", "articleId": "id van het artikel waar je antwoord over gaat, of \\"geen\\""}
Gebruik "geen" bij de opening en als je antwoord niet over één specifiek artikel gaat.`;

// Welke berichten mee mogen. Altijd de drie uit de opening, want daar verwijst de
// gebruiker naar ("die eerste"). Daarna vanaf het actieve bericht verder, zodat
// "volgende onderwerp" altijd een bericht heeft, en met de rest aanvullen tot MAX_ARTICLES.
// De nummering blijft de positie in de hele lijst, zodat verwijzingen blijven kloppen.
function selection(stories: Article[], activeIndex: number) {
  const picked = new Set<number>();
  for (let i = 0; i < Math.min(OPENING_COUNT, stories.length); i++) picked.add(i);
  for (let i = Math.max(activeIndex, 0); i < stories.length && picked.size < MAX_ARTICLES; i++) picked.add(i);
  for (let i = OPENING_COUNT; i < stories.length && picked.size < MAX_ARTICLES; i++) picked.add(i);
  return [...picked].sort((a, b) => a - b);
}

// Alleen het actieve bericht gaat vrijwel volledig mee; van de rest de kern. Vraagt de
// gebruiker naar zo'n bericht, dan is het de beurt daarna actief en komt de rest alsnog.
function excerpt(body: string, max: number) {
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut.trimEnd()}\n(dit bericht is hier ingekort)`;
}

function context(stories: Article[], activeArticleId: string | null) {
  const now = new Date().toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const activeIndex = stories.findIndex((a) => a.id === activeArticleId);

  const articles = selection(stories, activeIndex)
    .map((i) => {
      const a = stories[i];
      return `ONDERWERP ${i + 1}
id: ${a.id}
titel: ${a.title}
onderwerp: ${a.topic}
bron: ${a.source}
datum: ${a.published}
tekst:
${excerpt(a.body, i === activeIndex ? ACTIVE_BODY : OTHER_BODY)}`;
    })
    .join('\n\n---\n\n');

  return `Nu: ${now}
Actief onderwerp: ${activeIndex === -1 ? 'nog geen' : `${activeIndex + 1} (${stories[activeIndex].id})`}

ARTIKELEN VAN VANDAAG

${articles}`;
}

// De laatste beurten, zodat een lang gesprek de aanvraag niet laat groeien. De regel
// hierboven is de opening (een user-beurt), dus begint het venster bij een antwoord van
// Nova: user en model horen elkaar af te wisselen.
function recent(history: Turn[]) {
  const start = Math.max(history.length - MAX_HISTORY, 0);
  return history.slice(start > 0 && history[start].role === 'user' ? start - 1 : start);
}

export async function generateNewsResponse({
  stories,
  history,
  activeArticleId,
}: {
  stories: Article[];
  history: Turn[];
  activeArticleId: string | null;
}): Promise<NewsResponse> {
  try {
    const raw = await generateJson(`${SYSTEM}\n\n${context(stories, activeArticleId)}`, [
      { role: 'user', content: OPENING },
      ...recent(history),
    ]);
    const parsed = JSON.parse(raw);
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) throw new Error(`Onbruikbaar antwoord: ${raw}`);

    const known = stories.some((a) => a.id === parsed.articleId);
    return { text: parsed.text.trim(), articleId: known ? parsed.articleId : null, mode: 'ai' };
  } catch (err) {
    console.error('[ai] Gemini niet gebruikt, terugval op regels:', err);

    const last = history.at(-1);
    const index = stories.findIndex((a) => a.id === activeArticleId);
    const reply = last ? respond(last.content, stories, index === -1 ? null : index) : briefing(stories);
    return { ...reply, mode: 'fallback' };
  }
}
