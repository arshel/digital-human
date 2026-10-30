import type { NewsArticle } from './articles';
import { fallbackExplanation } from './fallback';
import * as gemini from './gemini';
import * as groq from './groq';
import * as mistral from './mistral';
import { buildPrompt, buildRoutePrompt, PROMPT_VERSION, ROUTE_SYSTEM, SYSTEM, type Action, type Previous } from './prompt';
import { pickRoute, type Candidate } from './questions';
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

// Op volgorde: Groq, Mistral, Gemini, maar alleen die met een sleutel in .env.local. Faalt de
// eerste (of is die te traag), dan de volgende. Andere volgorde: AI_PROVIDERS=mistral,gemini.
const PROVIDERS = { groq, mistral, gemini };
const KEYS = { groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', gemini: 'GEMINI_API_KEY' } as const;
type Provider = keyof typeof PROVIDERS;

export function aiProviders(): Provider[] {
  const order = (process.env.AI_PROVIDERS || 'groq,mistral,gemini').split(',').map((p) => p.trim());
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
  return { id: pickRoute(text, list), attempts };
}
