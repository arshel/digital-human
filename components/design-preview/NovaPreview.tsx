'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnchorStage } from '@/components/AnchorStage';
import type { NewsResponse } from '@/lib/ai';
import type { Article } from '@/lib/news';
import styles from './NovaPreview.module.css';

// Experimentele vormgeving op /design-preview. Zelfde API-route, gesprekscontract en
// AnchorStage als app/page.tsx; alleen indeling en stijl verschillen. De gesprekslogica
// staat hier bewust als kopie, zodat de oude pagina niet verbouwd hoeft te worden.

type Turn = { role: 'user' | 'assistant'; content: string; articleId?: string | null };
type Reply = NewsResponse & { stories: Article[]; live: boolean };
type Failure = { message: string; history: Turn[] };

// Dezelfde zinnen als QUICK_ACTIONS in app/page.tsx: lib/ai.ts en lib/fallback.ts herkennen precies deze.
const EXPLAIN_ACTIONS: { question: string; icon: ReactNode }[] = [
  { question: 'Leg het makkelijker uit', icon: <SimplerIcon /> },
  { question: 'Wat betekent dit?', icon: <MeaningIcon /> },
  { question: 'Waarom is dit belangrijk?', icon: <WhyIcon /> },
];
const NEXT_TOPIC = 'Volgende onderwerp';

// De opening gaat over de eerste drie verhalen (OPENING_COUNT in lib/news.ts; niet
// geïmporteerd omdat die module de demo-artikelen in de clientbundel zou trekken).
const OPENING_COUNT = 3;

function nlDate(iso: string) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function NovaPreview() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stories, setStories] = useState<Article[]>([]);
  const [live, setLive] = useState(true);
  const [mode, setMode] = useState<Reply['mode']>('ai');
  const [draft, setDraft] = useState('');
  // true vanaf de eerste render: de opening wordt meteen opgehaald.
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [largeText, setLargeText] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(false);
  const started = useRef(false);
  const presenter = useRef<HTMLElement>(null);
  const ambient = useRef<HTMLVideoElement>(null);
  const id = useId();

  const article = stories.find((a) => a.id === activeId) ?? null;
  const lastAnswerIndex = turns.map((t) => t.role).lastIndexOf('assistant');
  const current = lastAnswerIndex >= 0 ? turns[lastAnswerIndex] : null;
  const openingStories = lastAnswerIndex === 0 ? stories.slice(0, OPENING_COUNT) : [];
  const noNews = current !== null && stories.length === 0;
  const blocked = busy || noNews;

  async function ask(history: Turn[]) {
    // De ref blokkeert ook een tweede klik die binnenkomt voordat React opnieuw rendert.
    if (sending.current) return;
    sending.current = true;
    const last = history[history.length - 1];
    setBusy(true);
    setFailure(null);
    setPending(last?.role === 'user' ? last.content : '');

    try {
      const res = await fetch('/api/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, activeArticleId: activeId, storyIds: stories.map((a) => a.id) }),
      });

      if (!res.ok) {
        // De server legt bij 400 en 429 uit wat er mis is; anders een algemene melding.
        const problem = await res.json().catch(() => null);
        if (mounted.current) {
          setFailure({ message: problem?.error ?? 'Nova kan nu geen antwoord maken. Probeer het opnieuw.', history });
        }
        return;
      }

      const reply: Reply = await res.json();
      if (!mounted.current) return;
      if (reply.articleId) setActiveId(reply.articleId);
      setStories(reply.stories);
      setLive(reply.live);
      setMode(reply.mode);
      // De vraag komt pas in het gesprek als er een antwoord is, zodat "Opnieuw proberen"
      // precies dezelfde aanvraag nog eens stuurt.
      setTurns([...history, { role: 'assistant', content: reply.text, articleId: reply.articleId }]);
    } catch {
      if (mounted.current) {
        setFailure({ message: 'Geen verbinding met de server. Controleer je internet en probeer het opnieuw.', history });
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Openingsbriefing bij laden. De ref voorkomt een dubbele aanroep door React Strict Mode;
  // mounted voorkomt dat een antwoord na het wegnavigeren nog state zet. Een lopende
  // avatarsessie ruimt AnchorStage zelf op als deze pagina verdwijnt.
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      ask([]);
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  // Sfeerlaag: zodra de avatarvideo speelt, draait dezelfde stream nog eens groot en vaag
  // achter het beeld. Zo loopt Nova's eigen omgeving door tot de randen, in plaats van dat
  // hij als los schermpje in het vlak staat. Geen tweede sessie: het is dezelfde MediaStream.
  useEffect(() => {
    const section = presenter.current;
    const copy = ambient.current;
    if (!section || !copy) return;

    function mirror(e: Event) {
      const source = e.target;
      if (!(source instanceof HTMLVideoElement) || !copy || source === copy) return;
      if (source.srcObject) copy.srcObject = source.srcObject;
      else if (source.currentSrc) copy.src = source.currentSrc;
      copy.play().catch(() => {});
    }

    // 'playing' borrelt niet op, maar komt wel langs in de capture-fase.
    section.addEventListener('playing', mirror, true);
    return () => {
      section.removeEventListener('playing', mirror, true);
      copy.srcObject = null;
    };
  }, []);

  function send(question: string) {
    const text = question.trim();
    if (!text || blocked || sending.current) return false;
    ask([...turns, { role: 'user', content: text }]);
    return true;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (send(draft)) setDraft('');
  }

  function reload() {
    setTurns([]);
    setActiveId(null);
    ask([]);
  }

  const articleDate = article && nlDate(article.published);

  return (
    <div className={`${styles.page} ${largeText ? styles.large : ''}`}>
      <header className={styles.topbar}>
        <div className={`${styles.column} ${styles.bar}`}>
          <p className={styles.name}>Nova</p>
          <p className={styles.tagline}>Nieuws in duidelijke taal</p>
          <button type="button" className={styles.tool} aria-pressed={largeText} onClick={() => setLargeText((on) => !on)}>
            <span className={styles.toolGlyph} aria-hidden="true">
              <small>A</small>A
            </span>
            <span className={styles.toolLabel}>Grotere tekst</span>
          </button>
          <Link href="/" className={styles.back}>
            <ArrowLeftIcon />
            Terug naar huidige layout
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.srOnly}>Nova, nieuws in duidelijke taal</h1>

        {/* Schermbreed: Nova is het belangrijkste element van de pagina. */}
        <section ref={presenter} className={styles.presenter} aria-label="Nova, digitale presentator">
          <video
            ref={ambient}
            className={styles.ambient}
            muted
            playsInline
            disablePictureInPicture
            aria-hidden="true"
            tabIndex={-1}
          />
          <AnchorStage busy={busy} article={article} />
        </section>

        <div className={`${styles.column} ${styles.content}`}>
          <div className={`${styles.below} ${openingStories.length > 0 ? styles.withToday : ''}`}>
            <section className={styles.panel} aria-label="Uitleg en vervolgvragen">
              {/* Nova spreekt nog niet, dus dit is geen ondertiteling met timing maar de
                tekst van het huidige antwoord, direct onder het beeld. */}
              <div className={styles.explain} aria-live="polite">
                {busy ? (
                  <>
                    {pending && <p className={styles.asked}>Je vroeg: {pending}</p>}
                    <p className={styles.status}>
                      <span className={styles.pulse} aria-hidden="true" />
                      {current || pending ? 'Nova maakt een antwoord…' : 'Nova haalt het nieuws van vandaag op…'}
                    </p>
                  </>
                ) : (
                  current && <p className={styles.explainText}>{current.content}</p>
                )}
              </div>

              {failure && !busy && (
                <div className={`${styles.notice} ${styles.error}`} role="alert">
                  <p>{failure.message}</p>
                  <button type="button" className={styles.retry} onClick={() => ask(failure.history)}>
                    Opnieuw proberen
                  </button>
                </div>
              )}

              {noNews && !busy && (
                <div className={styles.notice} role="status">
                  <p>Er zijn nu geen nieuwsberichten beschikbaar. Probeer het later opnieuw.</p>
                  <button type="button" className={styles.retry} onClick={reload}>
                    Opnieuw laden
                  </button>
                </div>
              )}

              <div className={styles.actions}>
                {EXPLAIN_ACTIONS.map(({ question, icon }) => (
                  <button
                    key={question}
                    type="button"
                    className={styles.action}
                    aria-disabled={blocked}
                    onClick={() => send(question)}
                  >
                    {icon}
                    <span>{question}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`${styles.action} ${styles.primary}`}
                  aria-disabled={blocked}
                  onClick={() => send(NEXT_TOPIC)}
                >
                  <ArrowRightIcon />
                  <span>{NEXT_TOPIC}</span>
                </button>
              </div>

              <form className={styles.ask} onSubmit={submit}>
                <label htmlFor={`${id}-question`} className={styles.srOnly}>
                  Stel je vraag
                </label>
                <input
                  id={`${id}-question`}
                  className={styles.input}
                  value={draft}
                  placeholder="Stel je vraag"
                  autoComplete="off"
                  maxLength={2000}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  type="submit"
                  className={styles.send}
                  aria-disabled={blocked || !draft.trim()}
                  aria-label="Verstuur je vraag"
                >
                  <SendIcon />
                </button>
              </form>

              <footer className={styles.sourceRow}>
                {openingStories.length > 0 ? (
                  // De opening gaat over meerdere berichten; hun links staan per bericht onder "Vandaag".
                  <p className={styles.sourceText}>Bron: {[...new Set(openingStories.map((a) => a.source))].join(', ')}</p>
                ) : article ? (
                  <>
                    <p className={styles.sourceText}>
                      Bron: {article.source}
                      {articleDate && (
                        <>
                          {' · '}
                          <time dateTime={article.published}>{articleDate}</time>
                        </>
                      )}
                    </p>
                    <a className={styles.sourceButton} href={article.sourceUrl} target="_blank" rel="noreferrer">
                      Bekijk bron<span className={styles.srOnly}>: {article.title} (opent in nieuw tabblad)</span>
                      <ExternalIcon />
                    </a>
                  </>
                ) : current ? (
                  <p className={styles.sourceText}>Bij dit antwoord hoort geen nieuwsbericht.</p>
                ) : null}
                <p className={styles.disclosure}>
                  Digitale presentator · {mode === 'fallback' ? 'Zinnen uit het bericht' : 'Uitleg met AI'}
                </p>
              </footer>

              {current && (!live || mode === 'fallback') && (
                <div className={styles.fineprint}>
                  {!live && <p>De NOS-feed is nu niet bereikbaar. Nova gebruikt demo-artikelen met verzonnen bronnen.</p>}
                  {mode === 'fallback' && (
                    <p>Gemini is nu niet bereikbaar. Nova antwoordt tijdelijk met letterlijke zinnen uit de berichten.</p>
                  )}
                </div>
              )}
            </section>

            {openingStories.length > 0 && (
              <section className={styles.today} aria-labelledby={`${id}-today`}>
                <h2 id={`${id}-today`} className={styles.todayHeading}>
                  Vandaag
                </h2>
                <ol className={styles.todayList} role="list">
                  {openingStories.map((a, i) => {
                    const date = nlDate(a.published);
                    return (
                      <li key={a.id}>
                        <span className={styles.todayNumber} aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className={styles.todayTitle}>{a.title}</span>
                        <span className={styles.todayMeta}>
                          {a.source}
                          {date && ` · ${date}`} ·{' '}
                          <a className={styles.sourceLink} href={a.sourceUrl} target="_blank" rel="noreferrer">
                            Bekijk bron<span className={styles.srOnly}>: {a.title} (opent in nieuw tabblad)</span>
                          </a>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function SimplerIcon() {
  return (
    <Icon>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </Icon>
  );
}

function MeaningIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4M12 17.2v.1" />
    </Icon>
  );
}

function WhyIcon() {
  return (
    <Icon>
      <path d="M9.5 18h5M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8V16h5v-.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

function ArrowRightIcon() {
  return (
    <Icon>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

function ArrowLeftIcon() {
  return (
    <Icon size={18}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </Icon>
  );
}

function SendIcon() {
  return (
    <Icon size={22}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

function ExternalIcon() {
  return (
    <Icon size={17}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}
