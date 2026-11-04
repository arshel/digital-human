import type { NewsArticle } from './articles';
import { fallbackExplanation } from './fallback';
import * as gemini from './gemini';
import * as groq from './groq';
import * as mistral from './mistral';
import * as openai from './openai';
import {
  buildClassifyPrompt,
  buildOverviewPrompt,
  buildPrompt,
  CLASSIFY_SYSTEM,
  OVERVIEW_SYSTEM,
  PROMPT_VERSION,
  SYSTEM,
  type Action,
  type Previous,
} from './prompt';
import { clock, parseBeslissing, sentence, type Candidate, type Classification, type Period } from './questions';
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

async function generateJson(system: string, messages: gemini.Message[], attempts: gemini.Attempt[], options: gemini.GenerateOptions = {}) {
  const errors: string[] = [];
  for (const name of aiProviders()) {
    try {
      return await PROVIDERS[name].generateJson(system, messages, attempts, options);
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
    return { spoken, mode: 'ai', model, promptVersion: PROMPT_VERSION, attempts, words };
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

// De beslissing bij een vraag (lib/questions.ts). Een ander model dan voor het antwoord: Groq telt
// de minuutlimiet per model, dus zo delen beslissing en antwoord die niet. gpt-oss-120b koos in
// een test van 3 november 2026 vaker het juiste bericht dan qwen. Temperatuur 0: dezelfde vraag,
// dezelfde beslissing. Gooit niet: een fout komt terug als { fout }, met de pogingen.
const CLASSIFY_MODELS = (process.env.CLASSIFY_MODELS || 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',').map((m) => m.trim());

export async function classifyQuestion(
  current: NewsArticle,
  previous: Previous[],
  list: Candidate[],
  question: string,
  now = Date.now(),
): Promise<{ result: Classification; attempts: gemini.Attempt[] }> {
  const attempts: gemini.Attempt[] = [];
  const nowLabel = new Date(now).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'full', timeStyle: 'short' });
  try {
    const { text } = await generateJson(
      CLASSIFY_SYSTEM,
      [{ role: 'user', content: buildClassifyPrompt(current, previous, list, question, nowLabel) }],
      attempts,
      { prefer: CLASSIFY_MODELS, temperature: 0 },
    );
    return { result: parseBeslissing(text, new Set(list.map((c) => c.id))), attempts };
  } catch (err) {
    return { result: { fout: err instanceof Error ? err.message : String(err) }, attempts };
  }
}

// Een vaste zin zonder taalmodel ("Ik heb vandaag geen nieuws over Gaza."). mode 'ai': dit is een
// volledig antwoord, dus geen terugvalmelding in beeld. model null laat in het testlog zien dat er
// geen taalmodel aan te pas kwam.
export function fixedAnswer(spoken: string): Explanation {
  return { spoken: cleanSpoken(spoken), mode: 'ai', model: null, promptVersion: PROMPT_VERSION, attempts: [], words: [] };
}

// Een kort overzicht van berichten, voor een algemene vraag als "Wat gebeurde er vandaag?"
// (lib/questions.ts kiest de berichten). Alleen uit titels en het begin van de tekst. Lukt het
// taalmodel niet, dan de titels zelf: die komen letterlijk uit de bron.
export async function generateOverview(stories: NewsArticle[], question: string, period?: Period): Promise<Explanation> {
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

export function fallbackOverview(stories: NewsArticle[], period?: Period, foreign = false) {
  if (!stories.length) return 'Er is nu geen ander nieuws.';
  const publisher = stories[0].publisher;
  const titles = stories.map((a) => (period ? `Om ${clock(a.published)} uur: ${sentence(a.title)}` : sentence(a.title)));
  const kind = foreign ? 'buitenlandse nieuws' : 'nieuws';
  const intro = period
    ? `Dit is het ${kind} van de ${publisher} ${period.of}.`
    : `Dit zijn de nieuwste ${foreign ? 'buitenlandse ' : ''}berichten van de ${publisher}.`;
  return `${intro} ${titles.join(' ')} Vraag gerust meer over een van deze berichten.`;
}
