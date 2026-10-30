// Aanbieders met de chat-API in OpenAI-vorm (Groq, Mistral), met dezelfde functie-vorm als
// lib/gemini.ts. Alleen server-side importeren: leest de sleutel uit process.env.

import { attemptResult, type Attempt, type Message } from './gemini';

type Options = {
  name: string;
  url: string;
  keyEnv: string;
  models: string[];
  // Per model. Deze aanbieders antwoorden normaal binnen een paar seconden; duurt het langer,
  // dan liever door naar de volgende aanbieder dan blijven wachten.
  timeoutMs: number;
  extra?: (model: string) => Record<string, unknown>;
};

export function chatProvider({ name, url, keyEnv, models, timeoutMs, extra }: Options) {
  return async function generateJson(system: string, messages: Message[], attempts: Attempt[] = []): Promise<{ text: string; model: string }> {
    const key = process.env[keyEnv];
    if (!key) throw new Error(`${keyEnv} ontbreekt in .env.local`);

    const errors: string[] = [];
    for (const model of models) {
      const started = Date.now();
      try {
        const text = await call(model, key);
        attempts.push({ provider: name.toLowerCase(), model, ms: Date.now() - started, result: 'ok' });
        return { text, model };
      } catch (err) {
        attempts.push({ provider: name.toLowerCase(), model, ms: Date.now() - started, result: attemptResult(err) });
        errors.push(`${model}: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw new Error(`${name} gaf geen antwoord\n${errors.join('\n')}`);

    async function call(model: string, key: string) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, ...messages],
          temperature: 0.4,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
          ...extra?.(model),
        }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text) throw new Error(`geen tekst (finish_reason: ${data.choices?.[0]?.finish_reason ?? 'onbekend'})`);
      return text;
    }
  };
}

export function modelList(env: string | undefined, fallback: string) {
  return (env || fallback)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}
