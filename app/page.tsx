'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnchorStage, type AvatarStatus, type KeepClear } from '@/components/AnchorStage';
import { Panel } from '@/components/Panel';
import { splitSentences, useReadAlong } from '@/components/useReadAlong';
import {
  AgainIcon,
  AskIcon,
  BackIcon,
  ExplainIcon,
  ExternalIcon,
  MeaningIcon,
  NextIcon,
  PlayIcon,
  SendIcon,
  SimplerIcon,
  SourceIcon,
  WhyIcon,
} from '@/components/icons';
import type { NewsResponse } from '@/lib/ai';
import type { Article } from '@/lib/news';

type Turn = { role: 'user' | 'assistant'; content: string; articleId?: string | null };
type Reply = NewsResponse & { stories: Article[]; live: boolean };
// Wat er naar /api/anchor gaat, plus wat de interface ondertussen laat zien.
type Request = { history: Turn[]; label: string; activeId: string | null };
type Failure = { message: string; request: Request };
type PanelName = 'extra' | 'ask' | 'news' | 'help' | 'source';

// De vervolgvragen onder "Extra uitleg". lib/ai.ts en lib/fallback.ts herkennen precies deze zinnen.
const EXPLAIN: { question: string; icon: ReactNode }[] = [
  { question: 'Leg het makkelijker uit', icon: <SimplerIcon /> },
  { question: 'Wat betekent dit?', icon: <MeaningIcon /> },
  { question: 'Waarom is dit belangrijk?', icon: <WhyIcon /> },
  { question: 'Opnieuw uitleggen', icon: <AgainIcon /> },
];
const NEXT_TOPIC = 'Volgende onderwerp';

// De opening gaat over de eerste drie verhalen (OPENING_COUNT in lib/news.ts; niet
// geïmporteerd omdat die module de demo-artikelen in de clientbundel zou trekken).
const OPENING_COUNT = 3;

const INTRO = ['Nova is een AI-presentator.', 'Nova legt het nieuws van vandaag uit in eenvoudige taal.'];

function nlDate(iso: string) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  // Alleen een datum aangeleverd (2026-09-12)? Dan ook geen tijd verzinnen.
  const time = iso.length > 10 ? ({ hour: '2-digit', minute: '2-digit' } as const) : {};
  return date.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', year: 'numeric', ...time });
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Uitlegtekst: elke zin op een eigen regel, de belangrijkste vet.
function Lines({ text, bold = 0 }: { text: string; bold?: number }) {
  return splitSentences(text).map((s, i) => <p key={i}>{i === bold ? <strong>{s}</strong> : s}</p>);
}

export default function Page() {
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stories, setStories] = useState<Article[]>([]);
  const [mode, setMode] = useState<Reply['mode']>('ai');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [draft, setDraft] = useState('');
  const [avatarRequest, setAvatarRequest] = useState(0);
  const [avatar, setAvatar] = useState<AvatarStatus>('idle');
  const [reading, setReading] = useState({ answer: -1, chunk: 0 });
  const [keepClear, setKeepClear] = useState<KeepClear>({ top: null, bottom: 0 });
  const sending = useRef(false);
  const mounted = useRef(true);
  const stage = useRef<HTMLElement>(null);
  const topic = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const subtitles = useRef<HTMLDivElement>(null);

  const article = stories.find((a) => a.id === activeId) ?? null;
  const lastAnswerIndex = turns.map((t) => t.role).lastIndexOf('assistant');
  const current = lastAnswerIndex >= 0 ? turns[lastAnswerIndex] : null;
  const opening = lastAnswerIndex === 0;
  const sources = opening ? stories.slice(0, OPENING_COUNT) : article ? [article] : [];
  const blocked = !started || busy;

  const sentences = useMemo(() => (current ? splitSentences(current.content) : INTRO), [current]);
  const chunks = useReadAlong(sentences, subtitles);
  const chunk = reading.answer === lastAnswerIndex ? Math.min(reading.chunk, chunks.length - 1) : 0;
  // Nova begint met de belangrijkste boodschap (zie de systeeminstructie), dus die zin staat
  // vet. Een begroeting of "Natuurlijk." telt niet; de opening gaat over drie dingen tegelijk.
  const keySentence = !current ? 0 : opening ? -1 : sentences.findIndex((s) => s.split(/\s+/).length >= 3);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Waar tekst en knoppen over het beeld liggen. AnchorStage houdt het gezicht daarbuiten.
  useLayoutEffect(() => {
    const s = stage.current;
    if (!s) return;
    const update = () => {
      const area = s.getBoundingClientRect();
      const t = topic.current?.getBoundingClientRect();
      const d = dock.current?.getBoundingClientRect();
      const next: KeepClear = {
        top: t ? { left: t.left - area.left, right: t.right - area.left, bottom: t.bottom - area.top } : null,
        bottom: d ? d.top - area.top : area.height,
      };
      // Het vlak moet minstens de tekst, de knoppen en een stuk beeld kunnen tonen. Past dat
      // niet (klein venster, grote tekst), dan scrolt de pagina in plaats van iets af te snijden.
      s.style.setProperty('--overlays', `${(next.top?.bottom ?? 0) + (d ? area.bottom - d.top : 0)}px`);
      setKeepClear((prev) =>
        prev.bottom === next.bottom &&
        prev.top?.left === next.top?.left &&
        prev.top?.right === next.top?.right &&
        prev.top?.bottom === next.top?.bottom
          ? prev
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    for (const el of [s, topic.current, dock.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  async function ask(request: Request) {
    // De ref blokkeert ook een tweede klik die binnenkomt voordat React opnieuw rendert.
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    setPending(request.label);

    try {
      const res = await fetch('/api/anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: request.history,
          activeArticleId: request.activeId,
          storyIds: stories.map((a) => a.id),
        }),
      });

      if (!res.ok) {
        // De server legt bij 400 en 429 uit wat er mis is; anders een algemene melding.
        const problem = await res.json().catch(() => null);
        if (mounted.current)
          setFailure({ message: problem?.error ?? 'Nova kan nu geen antwoord geven. Probeer het opnieuw.', request });
        return;
      }

      const reply: Reply = await res.json();
      if (!mounted.current) return;

      // Alleen echt nieuws. Is de NOS-feed niet bereikbaar, dan stuurt de server demo-artikelen
      // met verzonnen bronnen mee (lib/news.ts). Die tonen we in deze versie niet.
      if (!reply.live || reply.stories.length === 0) {
        setFailure({
          message: reply.stories.length
            ? 'De nieuwsbron is nu niet bereikbaar. Probeer het over een minuut opnieuw.'
            : 'Er is nu geen nieuws. Probeer het later opnieuw.',
          request,
        });
        return;
      }

      if (reply.articleId) setActiveId(reply.articleId);
      setStories(reply.stories);
      setMode(reply.mode);
      // De vraag komt pas in het gesprek als er een antwoord is, zodat "Opnieuw proberen"
      // precies dezelfde aanvraag nog eens stuurt.
      setTurns([...request.history, { role: 'assistant', content: reply.text, articleId: reply.articleId }]);
    } catch {
      if (mounted.current)
        setFailure({ message: 'Er is geen verbinding. Controleer je internet en probeer het opnieuw.', request });
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // Niets start vanzelf: de gebruiker kiest zelf wanneer het nieuws begint. Pas dan gaan de
  // eerste vraag naar Gemini en de avatarsessie van start.
  function startNews() {
    if (started) return;
    setStarted(true);
    setAvatarRequest((n) => n + 1);
    ask({ history: [], label: '', activeId: null });
  }

  // De startknop verdwijnt; de focus gaat naar de tekst die nu komt.
  useEffect(() => {
    if (started) subtitles.current?.focus();
  }, [started]);

  function send(question: string, label: string) {
    const text = question.trim();
    if (!text || blocked || sending.current) return false;
    setPanel(null);
    ask({ history: [...turns, { role: 'user', content: text }], label, activeId });
    return true;
  }

  // Een onderwerp uit "Ander nieuws". Het nummer is de positie in de hele lijst, net als in de
  // context voor Gemini; het artikel gaat als actief mee, zodat de volledige tekst erbij zit.
  function choose(index: number) {
    const story = stories[index];
    if (!story || blocked || sending.current) return;
    setPanel(null);
    ask({
      history: [...turns, { role: 'user', content: `Vertel over onderwerp ${index + 1}.` }],
      label: `Je koos: ${story.title}`,
      activeId: story.id,
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (send(draft, `Je vroeg: ${draft.trim()}`)) setDraft('');
  }

  function open(name: PanelName) {
    if ((name === 'extra' || name === 'ask') && blocked) return;
    setPanel(name);
  }

  const close = useCallback(() => setPanel(null), []);

  const turnPage = (to: number) => setReading({ answer: lastAnswerIndex, chunk: Math.max(0, Math.min(to, chunks.length - 1)) });

  // Wat er in de ondertiteling staat.
  let text: ReactNode;
  if (!started) {
    text = INTRO.map((s, i) => <p key={i}>{i === 0 ? <strong>{s}</strong> : s}</p>);
  } else if (busy) {
    text = (
      <>
        {pending && <p>{pending}</p>}
        <p className="status">
          <span className="pulse" aria-hidden="true" />
          {current || pending ? 'Nova maakt een antwoord…' : 'Nova haalt het nieuws op…'}
        </p>
      </>
    );
  } else if (failure) {
    text = <Lines text={failure.message} />;
  } else {
    text = (chunks[chunk] ?? []).map((s) => <p key={s.index}>{s.index === keySentence ? <strong>{s.text}</strong> : s.text}</p>);
  }

  const showTopic = started && !(failure && !current);

  return (
    <div className="app">
      <header className="header">
        <h1 className="brand">
          <span className="brand-name">Nova</span>
          <span className="brand-tagline">Nieuws met uitleg</span>
        </h1>
        <nav className="header-actions" aria-label="Menu">
          {stories.length > 0 && (
            <button type="button" className="btn btn-pill" aria-disabled={busy} onClick={() => !busy && open('news')}>
              Ander nieuws
            </button>
          )}
          <button type="button" className="btn btn-pill" onClick={() => open('help')}>
            Hoe werkt dit?
          </button>
        </nav>
      </header>

      <main ref={stage} className="stage">
        <AnchorStage startRequest={avatarRequest} onStatus={setAvatar} keepClear={keepClear} />

        {showTopic && (
          <div ref={topic} className="topic">
            <p className="badge">AI-presentator</p>
            <p className="topic-title">{!opening && article ? article.title : 'Het nieuws van vandaag'}</p>
            {mode === 'fallback' && current && (
              <p className="topic-note">
                <strong>De AI werkt nu niet.</strong>
                <br />
                Je leest zinnen uit het bericht.
              </p>
            )}
          </div>
        )}

        {started && avatar !== 'live' && avatar !== 'idle' && (
          <div className="stage-status" style={{ top: keepClear.bottom }}>
            {avatar === 'connecting' ? (
              <p>Het beeld van de presentator start…</p>
            ) : (
              <>
                <p>
                  <strong>{avatar === 'ended' ? 'Het beeld is gestopt.' : 'De presentator werkt nu niet.'}</strong>
                </p>
                <p>
                  {avatar === 'ended'
                    ? 'In deze testversie stopt het beeld na een tijdje vanzelf.'
                    : 'Je kunt het nieuws wel meelezen.'}
                </p>
                <button type="button" className="btn" onClick={() => setAvatarRequest((n) => n + 1)}>
                  <PlayIcon />
                  {avatar === 'ended' ? 'Start het beeld opnieuw' : 'Probeer het opnieuw'}
                </button>
              </>
            )}
          </div>
        )}

        <div ref={dock} className="dock">
          <section className="subtitles" aria-label="Tekst van Nova">
            <div ref={subtitles} className="subtitles-text" aria-live="polite" tabIndex={-1}>
              {text}
            </div>
            {started && !busy && failure && (
              <div className="subtitles-nav">
                <button type="button" className="btn" onClick={() => ask(failure.request)}>
                  <AgainIcon />
                  Opnieuw proberen
                </button>
              </div>
            )}
            {started && !busy && !failure && chunks.length > 1 && (
              <div className="subtitles-nav">
                <button type="button" className="btn" aria-disabled={chunk === 0} onClick={() => turnPage(chunk - 1)}>
                  <BackIcon />
                  Terug
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-disabled={chunk === chunks.length - 1}
                  onClick={() => turnPage(chunk + 1)}
                >
                  Verder
                  <NextIcon />
                </button>
                <span className="subtitles-count">
                  {chunk + 1} van {chunks.length}
                </span>
              </div>
            )}
          </section>

          <div className="controls">
            {!started ? (
              <button key="start" type="button" className="btn btn-primary control control-start" onClick={startNews}>
                <PlayIcon />
                Start nieuws
              </button>
            ) : (
              <>
                <button key="ask" type="button" className="btn control" aria-disabled={blocked} onClick={() => open('ask')}>
                  <AskIcon />
                  Stel een vraag
                </button>
                <button type="button" className="btn btn-primary control" aria-disabled={blocked} onClick={() => open('extra')}>
                  <ExplainIcon />
                  Extra uitleg
                </button>
                <button
                  type="button"
                  className="btn control"
                  aria-disabled={blocked}
                  onClick={() => send(NEXT_TOPIC, `Je koos: ${NEXT_TOPIC}`)}
                >
                  <NextIcon />
                  {NEXT_TOPIC}
                </button>
              </>
            )}
          </div>

          {sources.length > 0 && (
            <button type="button" className="source-link" onClick={() => open('source')}>
              <SourceIcon />
              {sources.length > 1 ? 'Bekijk de bronnen' : 'Bekijk de bron'}
            </button>
          )}
        </div>
      </main>

      <Panel open={panel === 'extra'} onClose={close} title="Extra uitleg" size="compact">
        <p>Kies wat je wilt weten.</p>
        <div className="options">
          {EXPLAIN.map(({ question, icon }, i) => (
            <button
              key={question}
              type="button"
              className="btn option"
              data-autofocus={i === 0 || undefined}
              onClick={() => send(question, `Je koos: ${question}`)}
            >
              {icon}
              {question}
            </button>
          ))}
        </div>
      </Panel>

      <Panel open={panel === 'ask'} onClose={close} title="Stel een vraag" size="compact">
        <form className="ask-form" onSubmit={submit}>
          <label htmlFor="question">Typ je vraag</label>
          <input
            id="question"
            data-autofocus
            value={draft}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p>Spreken kan nog niet.</p>
          <p>Je typt je vraag hier.</p>
          <button type="submit" className="btn btn-primary" aria-disabled={!draft.trim()}>
            <SendIcon />
            Verstuur
          </button>
        </form>
      </Panel>

      <Panel open={panel === 'news'} onClose={close} title="Ander nieuws">
        <p>Kies een onderwerp.</p>
        <p>Nova legt het uit.</p>
        <ul className="stories">
          {stories.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="btn story"
                aria-current={s.id === activeId ? 'true' : undefined}
                aria-disabled={busy}
                data-autofocus={i === 0 || undefined}
                onClick={() => choose(i)}
              >
                <strong>{s.title}</strong>
                <span>
                  {nlDate(s.published)}
                  {s.id === activeId && ' · Nu bezig'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel open={panel === 'source'} onClose={close} title={sources.length > 1 ? 'Bronnen' : 'Bron'}>
        {sources.length > 1 && <p>Nova vertelde over deze berichten.</p>}
        <ul className="sources">
          {sources.map((s) => {
            const date = nlDate(s.published);
            const host = hostname(s.sourceUrl);
            return (
              <li key={s.id}>
                <p>
                  <strong>{s.title}</strong>
                </p>
                <p>
                  Bron: <strong>{s.source}</strong>
                </p>
                {date && (
                  <p>
                    Gepubliceerd: <strong>{date}</strong>
                  </p>
                )}
                <a className="link" href={s.sourceUrl} target="_blank" rel="noreferrer" data-autofocus>
                  {host ? `Open het bericht op ${host}` : 'Open het bericht'}
                  <ExternalIcon />
                  <span className="sr-only"> (opent in een nieuw tabblad)</span>
                </a>
              </li>
            );
          })}
        </ul>
        <p>Nova gebruikt de tekst uit de nieuwsfeed van de bron.</p>
        <p>Nova is geen dienst van deze nieuwsbron.</p>
      </Panel>

      <Panel open={panel === 'help'} onClose={close} title="Hoe werkt dit?">
        <div className="help">
          <section>
            <h3>Wat is Nova?</h3>
            <p>
              <strong>Nova is een AI-presentator.</strong>
            </p>
            <p>Nova is geen echt mens.</p>
            <p>Een computer maakt de tekst met AI.</p>
          </section>
          <section>
            <h3>Waar komt het nieuws vandaan?</h3>
            <p>Nova gebruikt alleen berichten uit de nieuwsfeed van de NOS.</p>
            <p>
              <strong>Nova is geen dienst van de NOS.</strong>
            </p>
            <p>Bij elk onderwerp kun je de bron bekijken.</p>
          </section>
          <section>
            <h3>Kan Nova fouten maken?</h3>
            <p>
              <strong>AI kan fouten maken.</strong>
            </p>
            <p>Twijfel je?</p>
            <p>Lees dan het bericht bij de bron.</p>
          </section>
          <section>
            <h3>Welke knoppen zijn er?</h3>
            <p>
              <strong>Stel een vraag:</strong> je typt zelf een vraag.
            </p>
            <p>
              <strong>Extra uitleg:</strong> Nova legt het onderwerp nog een keer uit.
            </p>
            <p>
              <strong>Volgende onderwerp:</strong> Nova vertelt het volgende nieuws.
            </p>
            <p>
              <strong>Ander nieuws:</strong> je kiest zelf een onderwerp.
            </p>
            <p>
              <strong>Verder:</strong> je leest het volgende stukje tekst.
            </p>
          </section>
          <section>
            <h3>Hoor je niets?</h3>
            <p>
              <strong>Nova spreekt nog niet hardop.</strong>
            </p>
            <p>Lees de tekst in beeld mee.</p>
            <p>In deze testversie stopt het beeld na een tijdje vanzelf.</p>
          </section>
        </div>
      </Panel>
    </div>
  );
}
