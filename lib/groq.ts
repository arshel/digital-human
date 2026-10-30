// Groq: open modellen op eigen chips, meestal binnen een seconde. Gratis tier zonder creditcard
// (console.groq.com), maar per model maar 8000 tokens per minuut; een Nova-vraag is er ongeveer
// 3000. Daarom meerdere modellen: elk heeft een eigen limiet, en bij een 429 (binnen een tiende
// seconde) neemt het volgende het over. Groq vervangt modellen geregeld; zet dan GROQ_MODELS.
//
// Getest op 27 oktober 2026: qwen schrijft de kortste zinnen (ongeveer 7 woorden, dicht bij A2);
// gpt-oss-120b is precies maar schrijft langere zinnen en moeilijkere woorden.

import { chatProvider, modelList } from './openai-chat';

export const generateJson = chatProvider({
  name: 'Groq',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  keyEnv: 'GROQ_API_KEY',
  models: modelList(process.env.GROQ_MODELS, 'qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b'),
  timeoutMs: 8000,
  // gpt-oss denkt eerst na; voor deze korte teksten is weinig nadenken genoeg, en veel sneller.
  extra: (model) => (model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
});
