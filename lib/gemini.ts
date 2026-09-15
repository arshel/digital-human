// Het enige bestand dat Gemini kent. Alleen server-side importeren: leest de key uit
// process.env. Een andere provider (OpenAI, Claude) = een bestand met dezelfde
// functie-vorm, en de import in lib/ai.ts omzetten.

type Message = { role: 'user' | 'assistant'; content: string };

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function generateJson(system: string, messages: Message[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY ontbreekt in .env.local');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(20000),
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
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  if (!text) {
    throw new Error(`Gemini gaf geen tekst terug (finishReason: ${data.candidates?.[0]?.finishReason ?? 'onbekend'})`);
  }
  return text;
}
