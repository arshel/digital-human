// Mistral. Let op: de gratis tier (Experiment) mag de invoer gebruiken om modellen te trainen,
// ook de vragen van deelnemers. Voor een echte gebruikerstest: betaald plan, of deelnemers dat
// vooraf laten weten.

import { chatProvider, modelList } from './openai-chat';

export const generateJson = chatProvider({
  name: 'Mistral',
  url: 'https://api.mistral.ai/v1/chat/completions',
  keyEnv: 'MISTRAL_API_KEY',
  // mistral-small: snel en goed in het Nederlands.
  models: modelList(process.env.MISTRAL_MODELS, 'mistral-small-latest'),
  timeoutMs: 10000,
});
