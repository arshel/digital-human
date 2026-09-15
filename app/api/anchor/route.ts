import articles from '@/data/articles.json';

const BRIEFING = 'Geef je openingssamenvatting van dit artikel.';

export async function POST(req: Request) {
  const { articleId, messages } = await req.json();
  const article = articles.find((a) => a.id === articleId);

  if (!article) {
    return Response.json({ error: 'Onbekend artikel.' }, { status: 400 });
  }

  const system = `Je bent Nova, een digitale nieuwspresentator voor jongeren van 16 tot 24 jaar.

Je werkt met precies één artikel. Dit is de volledige tekst:

Titel: ${article.title}
Bron: ${article.source}
Datum: ${article.published}

${article.body}

Regels:
- Gebruik uitsluitend informatie uit bovenstaand artikel. Geen eigen kennis, geen aannames, geen inschattingen.
- Staat het antwoord niet in het artikel, zeg dan kort dat dit artikel daar niets over zegt, en noem waar het artikel wél over gaat.
- Verzin nooit cijfers, namen, data of citaten.
- Praat zoals een presentator praat: korte zinnen, actieve taal, spreektaal zonder jargon. Geen emoji, geen opsommingstekens, geen kopjes.
- Je openingssamenvatting is maximaal vier zinnen: wat er gebeurt, voor wie het uitmaakt, en wat er nog onduidelijk is.
- Vervolgvragen antwoord je in maximaal drie zinnen.
- Je praat Nederlands.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: BRIEFING }, ...messages],
    }),
  });

  if (!res.ok) {
    return Response.json({ error: await res.text() }, { status: 502 });
  }

  const data = await res.json();
  return Response.json({ text: data.content[0].text });
}
