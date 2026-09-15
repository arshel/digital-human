'use client';

import { useEffect, useRef, useState } from 'react';
import type { Article } from '@/lib/news';
import { AnchorStage } from '@/components/AnchorStage';

type Turn = { role: 'user' | 'assistant'; content: string; articleId?: string | null };
type NewsResponse = {
  text: string;
  articleId: string | null;
  mode: 'ai' | 'fallback';
  stories: Article[];
  live: boolean;
};

const QUICK_ACTIONS = ['Meer uitleg', 'Waarom is dit belangrijk?', 'Volgende onderwerp', 'Leg het makkelijker uit'];

function nlDate(iso: string) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Page() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [mode, setMode] = useState<NewsResponse['mode']>('ai');
  const [stories, setStories] = useState<Article[]>([]);
  const [live, setLive] = useState(true);
  const started = useRef(false);

  const article = stories.find((a) => a.id === activeId) ?? null;
  const lastAnswerIndex = turns.map((t) => t.role).lastIndexOf('assistant');
  const current = turns[lastAnswerIndex];
  const earlier = turns.slice(0, lastAnswerIndex);

  async function ask(history: Turn[]) {
    setBusy(true);
    setFailure('');

    try {
      const res = await fetch('/api/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, activeArticleId: activeId, storyIds: stories.map((a) => a.id) }),
      });

      if (!res.ok) {
        setFailure('Nova kan geen antwoord ophalen. Probeer het opnieuw.');
        return;
      }

      const reply: NewsResponse = await res.json();

      // Hier komt het antwoord binnen als platte tekst. Nu tonen we het;
      // later ook: avatar.speak(reply.text)
      if (reply.articleId) setActiveId(reply.articleId);
      setStories(reply.stories);
      setLive(reply.live);
      setMode(reply.mode);
      setTurns([...history, { role: 'assistant', content: reply.text, articleId: reply.articleId }]);
    } catch {
      setFailure('Geen verbinding met de server. Probeer het opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  // Openingsbriefing bij laden. De ref voorkomt een dubbele aanroep door React Strict Mode.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ask([]);
  }, []);

  function send(question: string) {
    if (busy || !question.trim()) return;
    const history: Turn[] = [...turns, { role: 'user', content: question.trim() }];
    setTurns(history);
    setDraft('');
    ask(history);
  }

  // De openingsbriefing gaat over alle verhalen, een ander antwoord over één bron (of geen).
  const currentSources = !current
    ? []
    : current.articleId
      ? stories.filter((a) => a.id === current.articleId)
      : lastAnswerIndex === 0
        ? stories
        : [];

  return (
    <main className="shell">
      <header className="intro">
        <h1 className="brand">Nova</h1>
        <div className="now">
          <span className="dot" aria-hidden="true" />
          Uitzending van vandaag
        </div>
      </header>

      <AnchorStage busy={busy} article={article} />

      <section className="current" aria-live="polite">
        {busy ? (
          <p className="thinking">Nova leest de verhalen…</p>
        ) : current ? (
          <>
            <p className="current-text">{current.content}</p>
            {currentSources.length > 0 && (
              <p className="turn-source">
                Bron:{' '}
                {currentSources.map((a, j) => (
                  <span key={a.id}>
                    {j > 0 && ', '}
                    <a href={a.sourceUrl} target="_blank" rel="noreferrer">{a.source}</a>
                  </span>
                ))}
              </p>
            )}
          </>
        ) : null}
        {failure && <p className="failure">{failure}</p>}
      </section>

      <div className="chips">
        {QUICK_ACTIONS.map((q) => (
          <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="composer">
        <input
          value={draft}
          placeholder="Vraag Nova iets over het nieuws"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(draft)}
        />
        <button disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          Vraag
        </button>
      </div>

      {earlier.length > 0 && (
        <details className="drawer">
          <summary>Eerder in dit gesprek</summary>
          <div className="transcript">
            {earlier.map((turn, i) => (
              <div key={i} className={turn.role === 'assistant' ? 'turn-anchor' : 'turn-you'}>
                {turn.content}
              </div>
            ))}
          </div>
        </details>
      )}

      {stories.length > 0 && (
        <details className="drawer">
          <summary>Bronnen</summary>
          <ol className="sources">
            {stories.map((a) => (
              <li key={a.id} aria-current={a.id === activeId}>
                <span className="source-title">{a.title}</span>
                <span className="source-meta">
                  {a.source}, {nlDate(a.published)} ·{' '}
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer">bron openen</a>
                </span>
                <details>
                  <summary>Tekst die Nova kreeg</summary>
                  {a.body.split('\n\n').map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="grounding">
        {live
          ? 'Nieuws uit de NOS-feed. Nova gebruikt voor nieuwsfeiten alleen deze berichten.'
          : 'De NOS-feed is nu niet bereikbaar. Nova gebruikt demo-artikelen met verzonnen bronnen.'}
        {mode === 'fallback' && ' Gemini is nu niet bereikbaar, dus Nova antwoordt tijdelijk met letterlijke zinnen uit de berichten.'}
      </p>
    </main>
  );
}
