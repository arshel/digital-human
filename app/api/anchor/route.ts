import { generateNewsResponse, type Turn } from '@/lib/ai';
import { getStories } from '@/lib/news';

export async function POST(req: Request) {
  const { messages, activeArticleId, storyIds } = await req.json();

  const history: Turn[] = messages.map((m: Turn) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content),
  }));

  const { stories, live } = await getStories(storyIds);
  const reply = await generateNewsResponse({ stories, history, activeArticleId: activeArticleId ?? null });

  // stories gaan mee terug zodat de interface bronnen kan tonen en dezelfde set blijft gebruiken.
  return Response.json({ ...reply, stories, live });
}
