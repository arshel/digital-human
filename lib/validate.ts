import type { Action, Previous } from './prompt';

// Validatie van POST /api/explain. De body is `unknown` tot hij bewezen goed is. Fout is fout:
// één duidelijke melding, nooit een 500. Los van de route, zodat het testbaar is.

const ACTIONS: Action[] = ['core', 'simpler', 'meaning', 'more', 'question'];
const MAX_ID = 100;
const MAX_QUESTION = 300; // een korte eigen vraag, geen geplakt document
const MAX_PREVIOUS = 6;
const MAX_SPOKEN = 1500;

export type ExplainRequest = { articleId: string; action: Action; question?: string; previous: Previous[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as string[]).includes(value);
}

export function validateExplain(body: unknown): ExplainRequest | string {
  if (!isObject(body)) return 'body moet een JSON-object zijn';
  const { articleId, action, question, previous } = body;

  if (typeof articleId !== 'string' || !articleId || articleId.length > MAX_ID) return 'articleId ontbreekt of is te lang';
  if (!isAction(action)) return `action moet een van ${ACTIONS.join(', ')} zijn`;

  let asked: string | undefined;
  if (action === 'question') {
    if (typeof question !== 'string' || !question.trim()) return 'question moet tekst bevatten';
    if (question.length > MAX_QUESTION) return `question is langer dan ${MAX_QUESTION} tekens`;
    asked = question.trim();
  }

  const earlier: Previous[] = [];
  if (previous !== undefined) {
    if (!Array.isArray(previous)) return 'previous moet een array zijn';
    // Alleen de laatste paar: genoeg om herhaling te voorkomen, zonder dat de aanvraag groeit.
    for (const p of previous.slice(-MAX_PREVIOUS)) {
      if (!isObject(p) || !isAction(p.action) || typeof p.spoken !== 'string' || !p.spoken.trim()) {
        return 'elk item in previous moet een action en spoken hebben';
      }
      earlier.push({ action: p.action, spoken: p.spoken.slice(0, MAX_SPOKEN) });
    }
  }

  return { articleId, action, question: asked, previous: earlier };
}
