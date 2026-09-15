// Het enige bestand dat Gemini kent. Alleen server-side importeren: leest de key uit
// process.env. Een andere provider (OpenAI, Claude) = een bestand met dezelfde
// functie-vorm, en de import in lib/ai.ts omzetten.

type Message = { role: 'user' | 'assistant'; content: string };

// Elk model heeft een eigen gratis quotum en raakt los van de andere overbelast (503).
// Daarom proberen we ze op volgorde: lukt het eerste niet, dan het volgende.
const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// Alles samen mag niet langer duren dan dit; daarna valt lib/ai.ts terug op de regels.
const TOTAL_BUDGET_MS = 25000;

// Model -> tijdstip tot wanneer we het overslaan (na een 429 of 503).
const coolingDown = new Map<string, number>();

class ModelError extends Error {
  constructor(message: string, readonly cooldownMs: number) {
    super(message);
  }
}

export async function generateJson(system: string, messages: Message[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY ontbreekt in .env.local');

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const available = MODELS.filter((m) => (coolingDown.get(m) ?? 0) <= Date.now());
  // Staan ze allemaal in de wacht, probeer dan toch het eerste: misschien is het weer vrij.
  const queue = available.length ? available : MODELS.slice(0, 1);
  const errors: string[] = [];

  for (const model of queue) {
    const remaining = deadline - Date.now();
    if (remaining < 2000) break;
    try {
      return await callModel(model, key, system, messages, remaining);
    } catch (err) {
      errors.push(`${model}: ${err instanceof Error ? err.message : err}`);
      if (err instanceof ModelError && err.cooldownMs > 0) {
        coolingDown.set(model, Date.now() + err.cooldownMs);
      }
    }
  }

  throw new Error(`Geen Gemini-model beschikbaar\n${errors.join('\n')}`);
}

async function callModel(model: string, key: string, system: string, messages: Message[], timeoutMs: number) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    // Kort per model, zodat er binnen het totaalbudget tijd overblijft voor het volgende.
    signal: AbortSignal.timeout(Math.min(timeoutMs, 10000)),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      // Google zegt hoe lang we moeten wachten ("retry in 10.6s"); minstens een minuut.
      const seconds = Number(body.match(/retry in ([\d.]+)s/i)?.[1] ?? 0);
      throw new ModelError('429 quotum op', Math.max(60, seconds) * 1000);
    }
    if (res.status === 503) throw new ModelError('503 overbelast', 30000);
    throw new ModelError(`${res.status}: ${body.slice(0, 300)}`, 0);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) {
    throw new ModelError(`geen tekst (finishReason: ${data.candidates?.[0]?.finishReason ?? 'onbekend'})`, 0);
  }
  return text;
}
