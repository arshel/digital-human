// OpenAI, via dezelfde chat-API als Groq en Mistral (lib/openai-chat.ts). Alleen server-side.
// Standaard gpt-4.1-mini: snel en goed in het Nederlands. Andere modellen: OPENAI_MODELS.

import { chatProvider, modelList } from './openai-chat';

// Nieuwere redeneermodellen (gpt-5, o-serie) kennen geen max_tokens en geen eigen temperature.
// Een veld op undefined valt weg uit het verzoek.
const reasoning = (model: string) => /^(gpt-5|o\d)/.test(model);

export const generateJson = chatProvider({
  name: 'OpenAI',
  url: 'https://api.openai.com/v1/chat/completions',
  keyEnv: 'OPENAI_API_KEY',
  models: modelList(process.env.OPENAI_MODELS, 'gpt-4.1-mini'),
  timeoutMs: 10000,
  extra: (model) =>
    reasoning(model) ? { max_tokens: undefined, max_completion_tokens: 2048, temperature: undefined, reasoning_effort: 'low' } : {},
});
