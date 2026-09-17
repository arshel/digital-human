import { generateNewsResponse, type Turn } from '@/lib/ai';
import { getStories } from '@/lib/news';

// De enige route naar Gemini, dus hier staat de deur op slot: de body is `unknown` tot
// die gevalideerd is, en per IP mag maar een beperkt aantal vragen per minuut binnenkomen.

const MAX_MESSAGES = 40; // beurten die de client mee mag sturen; lib/ai.ts stuurt er minder door
const MAX_MESSAGE_CHARS = 2000; // een vraag is een vraag, geen geplakt document
const MAX_STORY_IDS = 60; // ruim boven een feed van ~20 berichten
const MAX_ID_CHARS = 80;

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

type Body = { messages: Turn[]; activeArticleId: string | null; storyIds: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validate(body: unknown): Body | string {
  if (!isObject(body)) return 'body moet een JSON-object zijn';

  const { messages, activeArticleId, storyIds } = body;

  if (!Array.isArray(messages)) return 'messages moet een array zijn';
  if (messages.length > MAX_MESSAGES) return `messages bevat meer dan ${MAX_MESSAGES} berichten`;

  const turns: Turn[] = [];
  for (const message of messages) {
    if (!isObject(message)) return 'elk bericht moet een object zijn';
    if (message.role !== 'user' && message.role !== 'assistant') return 'role moet "user" of "assistant" zijn';
    if (typeof message.content !== 'string' || !message.content.trim()) return 'content moet tekst bevatten';
    if (message.content.length > MAX_MESSAGE_CHARS) return `content is langer dan ${MAX_MESSAGE_CHARS} tekens`;
    turns.push({ role: message.role, content: message.content.trim() });
  }

  if (activeArticleId !== undefined && activeArticleId !== null) {
    if (typeof activeArticleId !== 'string' || activeArticleId.length > MAX_ID_CHARS) return 'activeArticleId moet een string of null zijn';
  }

  if (storyIds !== undefined) {
    if (!Array.isArray(storyIds)) return 'storyIds moet een array zijn';
    if (storyIds.length > MAX_STORY_IDS) return `storyIds bevat meer dan ${MAX_STORY_IDS} ids`;
    if (storyIds.some((id) => typeof id !== 'string' || !id || id.length > MAX_ID_CHARS)) return 'storyIds moet strings bevatten';
  }

  return {
    messages: turns,
    activeArticleId: typeof activeArticleId === 'string' ? activeArticleId : null,
    storyIds: (storyIds as string[] | undefined) ?? [],
  };
}

// Rate limit in het geheugen van dit serverproces. Genoeg voor een prototype en een demo:
// het remt een losgeslagen client of een tabblad dat blijft herhalen. NIET genoeg voor een
// publieke productieomgeving: elke serverinstantie telt apart en bij een herstart begint
// het opnieuw. Daar hoort een gedeelde teller bij (Upstash Redis) of de rate limit van het
// platform zelf (bijvoorbeeld Vercel Firewall).
const hits = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Oude ip's opruimen, zodat de map niet blijft groeien.
  if (hits.size > 500) {
    for (const [key, times] of hits) if (now - times[times.length - 1] > WINDOW_MS) hits.delete(key);
  }

  return recent.length > MAX_REQUESTS;
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'lokaal';
  if (rateLimited(ip)) {
    return Response.json(
      { error: 'Te veel vragen achter elkaar. Wacht even en probeer het opnieuw.' },
      { status: 429, headers: { 'retry-after': String(WINDOW_MS / 1000) } },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const valid = validate(body);
  if (typeof valid === 'string') return Response.json({ error: `Ongeldige aanvraag: ${valid}` }, { status: 400 });

  const { stories, live } = await getStories(valid.storyIds);
  const reply = await generateNewsResponse({ stories, history: valid.messages, activeArticleId: valid.activeArticleId });

  // stories gaan mee terug zodat de interface bronnen kan tonen en dezelfde set blijft gebruiken.
  return Response.json({ ...reply, stories, live });
}
