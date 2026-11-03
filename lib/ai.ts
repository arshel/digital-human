import type { NewsArticle } from './articles';
import { fallbackExplanation } from './fallback';
import * as gemini from './gemini';
import * as groq from './groq';
import * as mistral from './mistral';
import * as openai from './openai';
import {
  buildOverviewPrompt,
  buildPrompt,
  buildRoutePrompt,
  OVERVIEW_SYSTEM,
  PROMPT_VERSION,
  ROUTE_SYSTEM,
  SYSTEM,
  type Action,
  type Previous,
} from './prompt';
import { clock, noRecentNews, periodLabel, pickRoute, pickTopic, recentStories, sentence, type Candidate } from './questions';
import { cleanSpoken } from './spoken';
import { pickHardWords, type HardWord } from './words';

// De AI-service. De rest van de app roept alleen generateExplanation() aan en weet niet welk
// model erachter zit. Het antwoord hoort altijd bij precies één bericht: dat kiest de server,
// niet het model. Zo kan een antwoord nooit bij een andere bron terechtkomen.

export type Explanation = {
  spoken: string;
  mode: 'ai' | 'fallback';
  model: string | null;
  promptVersion: string;
  // Elke modelpoging met duur en afloop, voor de metingen. Geen tekst.
  attempts: gemini.Attempt[];
  // Moeilijke woorden in `spoken`, met uitleg (zie lib/words.ts). Leeg bij de terugval.
  words: HardWord[];
  // Bij een vraag: ging die over dit bericht? (zie lib/questions.ts)
  aboutArticle?: boolean;
};

// Op volgorde: OpenAI, Groq, Mistral, Gemini, maar alleen die met een sleutel in .env.local. Faalt de
// eerste (of is die te traag), dan de volgende. Andere volgorde: AI_PROVIDERS=mistral,gemini.
const PROVIDERS = { openai, groq, mistral, gemini };
const KEYS = { openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', gemini: 'GEMINI_API_KEY' } as const;
type Provider = keyof typeof PROVIDERS;

export function aiProviders(): Provider[] {
  const order = (process.env.AI_PROVIDERS || 'openai,groq,mistral,gemini').split(',').map((p) => p.trim());
  const usable = order.filter((p): p is Provider => p in PROVIDERS && !!process.env[KEYS[p as Provider]]);
  // Geen enkele sleutel: Gemini, zodat de foutmelding zegt welke sleutel ontbreekt.
  return usable.length ? usable : ['gemini'];
}

async function generateJson(system: string, messages: gemini.Message[], attempts: gemini.Attempt[]) {
  const errors: string[] = [];
  for (const name of aiProviders()) {
    try {
      return await PROVIDERS[name].generateJson(system, messages, attempts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors.join('\n'));
}

export async function generateExplanation({
  article,
  action,
  previous,
  question,
  simulateFailure = false,
}: {
  article: NewsArticle;
  action: Action;
  previous: Previous[];
  question?: string;
  // Alleen in ontwikkelmodus: test de terugval zonder Gemini echt te laten falen.
  simulateFailure?: boolean;
}): Promise<Explanation> {
  const attempts: gemini.Attempt[] = [];
  try {
    if (simulateFailure) throw new Error('gesimuleerde Gemini-fout (ontwikkelmodus)');
    const { text, model } = await generateJson(
      SYSTEM,
      [{ role: 'user', content: buildPrompt(article, action, previous, question) }],
      attempts,
    );
    const parsed = JSON.parse(text);
    const spoken = typeof parsed.spoken === 'string' ? cleanSpoken(parsed.spoken) : '';
    if (!spoken) throw new Error(`Onbruikbaar antwoord: ${text.slice(0, 200)}`);
    const words = pickHardWords(parsed.woorden, spoken, cleanSpoken);
    const aboutArticle = parsed.overBericht !== false;
    return { spoken, mode: 'ai', model, promptVersion: PROMPT_VERSION, attempts, words, aboutArticle };
  } catch (err) {
    console.error('[ai] taalmodel niet gebruikt, terugval op regels:', err instanceof Error ? err.message : err);
    return {
      spoken: cleanSpoken(fallbackExplanation(article, action, question)),
      mode: 'fallback',
      model: null,
      promptVersion: PROMPT_VERSION,
      attempts,
      words: [],
    };
  }
}

// Over welk bericht van vandaag gaat een vraag? Een id uit de lijst, of null. Fouten gooien: dan
// beweert Nova niets over het andere nieuws (zie lib/questions.ts).
export async function routeQuestion(question: string, list: Candidate[]) {
  const attempts: gemini.Attempt[] = [];
  const { text } = await generateJson(ROUTE_SYSTEM, [{ role: 'user', content: buildRoutePrompt(question, list) }], attempts);
  return { id: pickRoute(text, list), topic: pickTopic(text), attempts };
}

// Een kort overzicht van de nieuwste berichten, voor een algemene vraag als "Wat gebeurde er
// vandaag?" (lib/questions.ts). Alleen uit titels en het begin van de tekst. Lukt het taalmodel
// niet, dan de titels zelf: die komen letterlijk uit de bron.
export async function generateOverview(stories: NewsArticle[], question: string, period?: string): Promise<Explanation> {
  const foreign = stories.length > 0 && stories.every((a) => a.region === 'buitenland');
  const attempts: gemini.Attempt[] = [];
  const list = stories.map((a) => ({
    title: a.title,
    publisher: a.publisher,
    opening: a.body.replace(/\s+/g, ' ').slice(0, 200),
    time: period ? clock(a.published) : undefined,
  }));
  try {
    const { text, model } = await generateJson(OVERVIEW_SYSTEM, [{ role: 'user', content: buildOverviewPrompt(list, question, period, foreign) }], attempts);
    const parsed = JSON.parse(text);
    const spoken = typeof parsed.spoken === 'string' ? cleanSpoken(parsed.spoken) : '';
    if (!spoken) throw new Error(`Onbruikbaar overzicht: ${text.slice(0, 200)}`);
    return { spoken, mode: 'ai', model, promptVersion: PROMPT_VERSION, attempts, words: pickHardWords(parsed.woorden, spoken, cleanSpoken) };
  } catch (err) {
    console.error('[ai] overzicht zonder taalmodel:', err instanceof Error ? err.message : err);
    return {
      spoken: cleanSpoken(fallbackOverview(stories, period, foreign)),
      mode: 'fallback',
      model: null,
      promptVersion: PROMPT_VERSION,
      attempts,
      words: [],
    };
  }
}

export function fallbackOverview(stories: NewsArticle[], period?: string, foreign = false) {
  if (!stories.length) return 'Er is nu geen ander nieuws.';
  const publisher = stories[0].publisher;
  const titles = stories.map((a) => (period ? `Om ${clock(a.published)} uur: ${sentence(a.title)}` : sentence(a.title)));
  const kind = foreign ? 'buitenlandse nieuws' : 'nieuws';
  const intro = period
    ? `Dit is het ${kind} van de ${publisher} van ${period}.`
    : `Dit zijn de nieuwste ${foreign ? 'buitenlandse ' : ''}berichten van de ${publisher}.`;
  return `${intro} ${titles.join(' ')} Vraag gerust meer over een van deze berichten.`;
}

// "Wat is er de afgelopen 10 minuten gebeurd?": alleen berichten uit die tijd. Is er niets, dan
// zegt Nova dat, en wat het nieuwste bericht is en hoe laat het kwam. Dat zijn vaste zinnen en
// letterlijk de titel: geen taalmodel nodig.
export async function generateRecentOverview(
  articles: NewsArticle[],
  minutes: number,
  question: string,
  now = Date.now(),
): Promise<Explanation> {
  const period = periodLabel(minutes);
  const recent = recentStories(articles, minutes, now);
  if (recent.length) return generateOverview(recent, question, period);

  const spoken = noRecentNews(articles, period);
  // mode 'ai': dit is een volledig antwoord, dus geen terugvalmelding in beeld. model null laat in
  // het testlog zien dat er geen taalmodel aan te pas kwam.
  return { spoken: cleanSpoken(spoken), mode: 'ai', model: null, promptVersion: PROMPT_VERSION, attempts: [], words: [] } satisfies Explanation;
}
