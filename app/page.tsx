'use client';

import { useState } from 'react';
import articles from '@/data/articles.json';

type Turn = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Waarom raakt dit mij?',
  'Wie beslist hierover?',
  'Wat is nog onduidelijk?',
];

function nlDate(iso: string) {
  return new Date(iso).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function Page() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const article = articles.find((a) => a.id === activeId);

  async function ask(articleId: string, history: Turn[]) {
    setBusy(true);
    setFailure('');

    try {
      const res = await fetch('/api/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId, messages: history }),
      });

      if (!res.ok) {
        setFailure('Nova kan de samenvatting niet ophalen. Controleer ANTHROPIC_API_KEY in .env.local en probeer opnieuw.');
        return;
      }

      const data = await res.json();
      setTurns([...history, { role: 'assistant', content: data.text }]);
    } catch {
      setFailure('Geen verbinding met de server. Probeer het opnieuw.');
    } finally {
      setBusy(false);
    }
  }

  function selectStory(id: string) {
    setActiveId(id);
    setTurns([]);
    setDraft('');
    ask(id, []);
  }

  function send(question: string) {
    if (!activeId || busy || !question.trim()) return;
    const history: Turn[] = [...turns, { role: 'user', content: question.trim() }];
    setTurns(history);
    setDraft('');
    ask(activeId, history);
  }

  return (
    <main className="shell">
      <section className="rundown">
        <h1 className="brand">Nova</h1>
        <p className="brand-sub">Drie verhalen, uitgelegd door een presentator die alleen het artikel voor zich heeft.</p>

        <div className="now">
          <span className="dot" aria-hidden="true" />
          Uitzending van vandaag
        </div>

        <ul className="stories">
          {articles.map((a) => (
            <li key={a.id}>
              <button
                className="story"
                aria-current={a.id === activeId}
                onClick={() => selectStory(a.id)}
              >
                <div className="story-meta">
                  {a.topic}, {a.readTime} min lezen
                </div>
                <div className="story-title">{a.title}</div>
              </button>
            </li>
          ))}
        </ul>

        <p className="demo-note">
          Demodataset met verzonnen bronnen, bedoeld om de nieuws- en gespreksflow te testen.
        </p>
      </section>

      <section className="studio">
        <div className="frame">
          <div className="face" aria-hidden="true">N</div>

          {busy && (
            <div className="talking" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          )}

          {article ? (
            <div className="lower-third">
              <span className="lt-name">Nova, nieuwspresentator</span>
              <span className="lt-source">
                {article.source}, {nlDate(article.published)}
                <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                  bron openen
                </a>
              </span>
            </div>
          ) : (
            <p className="frame-empty">Kies een verhaal uit de rundown. Nova opent met een samenvatting, daarna vraag jij door.</p>
          )}
        </div>

        {article && (
          <details className="original">
            <summary>Lees het artikel zelf</summary>
            <h2>{article.title}</h2>
            {article.body.split('\n\n').map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </details>
        )}

        {article && (
          <div className="transcript">
            {turns.map((turn, i) => (
              <div key={i} className={turn.role === 'assistant' ? 'turn-anchor' : 'turn-you'}>
                {turn.content}
              </div>
            ))}

            {busy && <p className="thinking">Nova leest het artikel…</p>}
            {failure && <p className="failure">{failure}</p>}
          </div>
        )}

        {article && (
          <>
            <div className="chips">
              {SUGGESTIONS.map((q) => (
                <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>

            <div className="composer">
              <input
                value={draft}
                placeholder="Stel een vraag over dit verhaal"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send(draft)}
              />
              <button disabled={busy || !draft.trim()} onClick={() => send(draft)}>
                Vraag
              </button>
            </div>

            <p className="grounding">
              Nova antwoordt alleen met wat in dit artikel van {article.source} staat.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
