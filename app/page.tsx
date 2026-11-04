"use client";

import "./stage-stable.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Panel } from "@/components/Panel";
import { PresenterBackdrop } from "@/components/PresenterBackdrop";
import { usePresenter } from "@/components/presenter/usePresenter";
import { CycleTiming, type TimingReport } from "@/components/presenter/timing";
import type { ListenState, TimingEvent } from "@/components/presenter/types";
import {
  AgainIcon,
  AskIcon,
  CaptionsIcon,
  ExternalIcon,
  MeaningIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  SendIcon,
  MicIcon,
  SimplerIcon,
  AccessibilityIcon,
  TextSizeIcon,
  NewsIcon,
} from "@/components/icons";
import { splitSentences } from "@/lib/spoken";
import type { ArticleMeta } from "@/lib/articles";
import { linkWords, spokenExplanation, type HardWord, type Segment } from "@/lib/words";
import type { Action, Previous } from "@/lib/prompt";

// Alle state van het prototype staat hier. De presentator (gesimuleerd of Anam) zit achter
// usePresenter; deze pagina weet alleen wat die doet, niet hoe.

type Config = {
  newsMode: "test" | "live" | "eval";
  avatarMode: "simulated" | "anam";
  devTools: boolean;
  promptVersion: string;
  poster: string | null;
  idleVideo: string | null;
  articles: ArticleMeta[];
};

type Fragment = {
  articleId: string;
  action: Action;
  spoken: string;
  sentences: string[];
  mode: "ai" | "fallback";
  articleVersion: string;
  promptVersion: string;
  requestId: string;
  // Moeilijke woorden om aan te tikken (zie lib/words.ts).
  words: HardWord[];
};

// Van wachtbeeld naar live beeld: kort overvloeien in plaats van een harde wissel.
const REST_FADE_MS = 450;

type Problem = { message: string; retry?: () => void };
type PanelName = "ask" | "source" | "help" | "access" | "news" | "dev";
type Simulate = "" | "gemini-error" | "server-error";

// De drie uitlegknoppen. De opdracht per knop staat in lib/prompt.ts.
const EXPLAIN: { action: Action; label: string; icon: ReactNode }[] = [
  { action: "simpler", label: "Leg makkelijker uit", icon: <SimplerIcon /> },
  { action: "meaning", label: "Wat betekent dit?", icon: <MeaningIcon /> },
  { action: "more", label: "Vertel meer", icon: <MoreIcon /> },
];

const PREPARING: Record<Action, string> = {
  core: "Nova maakt de uitleg klaar.",
  simpler: "Nova zoekt een makkelijkere uitleg.",
  meaning: "Nova zoekt uit wat het betekent.",
  more: "Nova zoekt meer achtergrond.",
  question: "Nova zoekt het antwoord op je vraag.",
};

const CAPTIONS_KEY = "nova-captions";

function nlDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(iso.length > 10 ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function Page() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Het bericht in beeld, op id: de lijst kan verversen terwijl Nova praat of een antwoord onderweg
  // is, en dan verschuiven de posities. null: nog niets gekozen, dus het eerste bericht.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [fragment, setFragment] = useState<Fragment | null>(null);
  const [history, setHistory] = useState<Previous[]>([]);
  const [preparing, setPreparing] = useState<Action | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [captions, setCaptions] = useState(true);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [simulate, setSimulateState] = useState<Simulate>("");
  // Ook als ref: een "Probeer opnieuw" na een gesimuleerde fout moet een gewone aanvraag zijn.
  const simulateRef = useRef<Simulate>("");
  const setSimulate = (s: Simulate) => {
    simulateRef.current = s;
    setSimulateState(s);
  };
  // Elke nieuwe aanvraag of elk volgend bericht verhoogt dit. Een antwoord dat binnenkomt als
  // het nummer al verder is, hoort bij een oude vraag of een ander bericht en wordt genegeerd.
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  // Met een echte avatar: het nieuwe antwoord, tot Nova het begint uit te spreken. Zo verschijnen tekst en
  // stem tegelijk, in plaats van eerst de tekst en seconden later pas de stem.
  const waiting = useRef<Fragment | null>(null);
  // Een aangetikt woord dat Nova nu uitlegt, en waar ze daarna verdergaat (als ze aan het
  // vertellen was). `started`: de uitleg is hoorbaar begonnen.
  const aside = useRef<{ resume: { fragment: Fragment; from: number } | null; started: boolean } | null>(null);
  const [asideWord, setAsideWord] = useState<HardWord | null>(null);
  // Het wachtbeeld is na het vervagen weg (scheelt een tweede video die blijft afspelen).
  const [restGone, setRestGone] = useState(false);
  // Metingen per klik voor de ontwikkelserver (alleen getallen; zie app/api/timing).
  const cycleTiming = useRef(new CycleTiming());
  const sendTiming = useCallback((report: TimingReport | null) => {
    if (!report) return;
    fetch("/api/timing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  }, []);
  const onTiming = useCallback(
    (event: TimingEvent) => {
      const timing = cycleTiming.current;
      if (timing.event(event) === "done") sendTiming(timing.flush());
      // Zonder geluidsmeting komt er geen 'audio': dan kort na het eerste beeld afsluiten.
      else if (event.step === "playing")
        setTimeout(() => sendTiming(timing.flush(false, event.cycle)), 1500);
    },
    [sendTiming],
  );
  // Een gesproken vraag gaat dezelfde weg als een getypte (zie ask()).
  const askRef = useRef<(question: string) => void>(() => {});
  const [heard, setHeard] = useState("");
  const onHeard = useCallback((text: string) => {
    setHeard(text);
    askRef.current(text);
  }, []);
  const presenter = usePresenter(config?.avatarMode ?? null, preparing !== null, onTiming, onHeard);
  // Een echte avatar (Anam): video in beeld, tekst pas als Nova praat, metingen.
  const realAvatar = config?.avatarMode === "anam";

  const articles = config?.articles ?? [];
  const index = Math.max(0, articles.findIndex((a) => a.id === selectedId));
  const article = articles[index] ?? null;
  // Nederlands nieuws staat vooraan; daarachter buitenlands nieuws, alleen voor vragen (zie
  // lib/news.ts). "Volgend bericht" en de lijst gaan alleen over het Nederlandse deel.
  const homeCount = articles.filter((a) => a.region !== "buitenland").length;
  // Voor het verversen van de lijst (refreshArticles): welk bericht nu in beeld is.
  const shown = useRef({ article, articles, chosen: selectedId !== null, started });
  shown.current = { article, articles, chosen: selectedId !== null, started };
  // Alleen het antwoord van de laatste verversing telt: een trage oudere mag het niet overschrijven.
  const refreshSeq = useRef(0);
  const speaking =
    presenter.state === "speaking" || presenter.state === "loading";
  const paused = presenter.canResume;
  const blocked = !started || !!preparing;

  const loadConfig = useCallback(() => {
    setLoadFailed(false);
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setConfig)
      .catch(() => setLoadFailed(true));
  }, []);

  // Nieuwe berichten ophalen zonder het bericht in beeld kwijt te raken: dat blijft staan (op id),
  // ook als het intussen uit de feed is. Vóór Start, zolang er niets gekozen is, gewoon de nieuwe
  // opening. Mislukt het of komt er niets, dan blijft de oude lijst.
  const refreshArticles = useCallback(async (): Promise<ArticleMeta[] | null> => {
    const mine = ++refreshSeq.current;
    const data = await fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (mine !== refreshSeq.current) return shown.current.articles;
    const fresh: ArticleMeta[] | undefined = data?.articles;
    if (!fresh?.length) return null;
    const { article: current, chosen, started: isStarted } = shown.current;
    let list = fresh;
    if (current && (isStarted || chosen)) {
      // Het bericht in beeld blijft, ook als het uit de feed is. Vastzetten op id: zo blijft het
      // in beeld, waar het in de nieuwe lijst ook staat.
      if (!list.some((a) => a.id === current.id)) {
        // Buitenlands nieuws achteraan, zodat het Nederlandse nieuws vooraan blijft.
        list = current.region === "buitenland" ? [...list, current] : [current, ...list];
      }
      setSelectedId(current.id);
    }
    setConfig((prev) => (prev ? { ...prev, articles: list } : prev));
    return list;
  }, []);

  // Elke minuut, zolang het tabblad zichtbaar is, en meteen als je terugkomt. De server haalt de
  // NOS-feed ook hooguit eens per minuut op (lib/news.ts).
  useEffect(() => {
    if (!config) return;
    const tick = () => {
      if (document.visibilityState === "visible") refreshArticles();
    };
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [config !== null, refreshArticles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadConfig();
    try {
      if (localStorage.getItem(CAPTIONS_KEY) === "off") setCaptions(false);
      if (localStorage.getItem("nova-large-text") === "on") setLargeText(true);
    } catch {
      // Geen opslag (privévenster): ondertiteling blijft aan.
    }
  }, [loadConfig]);

  useEffect(() => {
    document.documentElement.dataset.textSize = largeText ? "large" : "normal";
    try {
      localStorage.setItem("nova-large-text", largeText ? "on" : "off");
    } catch {
      /* Sessievoorkeur blijft werken zonder opslag. */
    }
  }, [largeText]);

  function toggleCaptions() {
    const next = !captions;
    setCaptions(next);
    try {
      localStorage.setItem(CAPTIONS_KEY, next ? "on" : "off");
    } catch {
      // Niet bewaard; de keuze geldt dan alleen nu.
    }
  }

  async function explain(
    target: ArticleMeta,
    action: Action,
    question?: string,
    previous = history,
  ) {
    // Al een aanvraag onderweg? Dan niets: snel dubbelklikken mag geen tweede betaalde vraag geven.
    if (inflight.current) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    inflight.current = controller;
    waiting.current = null;
    endAside();
    if (realAvatar) sendTiming(cycleTiming.current.start(mine, action, performance.now()));
    presenter.stop();
    setPreparing(action);
    setProblem(null);

    // Verbinden en het antwoord maken tegelijk, zodat de gebruiker niet twee keer wacht. Lukt
    // de avatar niet, dan staat de tekst er toch.
    const connected = presenter.connect().then(
      (ready) => ready,
      () => false,
    );

    const simulating = simulateRef.current;
    if (simulating) setSimulate("");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(simulating ? { "x-nova-simulate": simulating } : {}),
        },
        body: JSON.stringify({
          articleId: target.id,
          action,
          question,
          previous,
        }),
      });
      const data = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (!res.ok || !data) {
        setProblem({
          message:
            data?.error ?? "Nova kan nu geen antwoord geven. Probeer opnieuw.",
          retry: () => explain(target, action, question, previous),
        });
        return;
      }
      // Hoort het antwoord bij een ander bericht, dan alleen als de server dat zegt: een vraag
      // over ander nieuws van vandaag (lib/questions.ts). Dan naar dat bericht, zodat bron, datum
      // en 'Bekijk bron' bij het antwoord horen. In alle andere gevallen nooit afspelen.
      let context = previous;
      if (data.articleId !== target.id) {
        // Op id, in de lijst van nu (niet die van toen de vraag begon): die kan intussen ververst zijn.
        const known = (list: ArticleMeta[] | null) => !!list?.some((a) => a.id === data.articleId);
        let found = data.switchedFrom === target.id && known(shown.current.articles);
        // Een bericht dat de server al kent en deze pagina nog niet: eerst de lijst verversen.
        if (!found && data.switchedFrom === target.id) {
          const fresh = await refreshArticles();
          if (mine !== seq.current) return;
          found = known(fresh);
        }
        if (!found) {
          setProblem({
            message: "Dit gaat over een bericht dat hier niet meer staat.",
          });
          return;
        }
        setSelectedId(data.articleId);
        context = [];
      }

      const next: Fragment = {
        ...data,
        action,
        sentences: splitSentences(data.spoken),
      };
      setHistory([...context, { action, spoken: data.spoken }].slice(-6));
      cycleTiming.current.text(mine, performance.now(), { requestId: data.requestId, ...data.timing });
      if (inflight.current === controller) inflight.current = null;
      setPreparing(null);

      const avatar = await connected;
      if (mine !== seq.current) return;
      if (realAvatar && avatar) {
        // Tekst pas tonen als Nova praat (of als dat mislukt): zie het effect op presenter.state.
        waiting.current = next;
        setFragment(null);
      } else {
        setFragment(next);
      }
      if (avatar) await presenter.speak(next.sentences, mine);
    } catch (err) {
      if (controller.signal.aborted || mine !== seq.current) return;
      console.error("[explain]", err);
      setProblem({
        message: "Verbinding verbroken. Probeer opnieuw.",
        retry: () => explain(target, action, question, previous),
      });
    } finally {
      if (inflight.current === controller) inflight.current = null;
      if (mine === seq.current) setPreparing(null);
    }
  }

  useEffect(() => {
    const next = waiting.current;
    if (!next) return;
    if (
      ["speaking", "paused", "error", "disconnected"].includes(presenter.state)
    ) {
      waiting.current = null;
      setFragment(next);
    }
  }, [presenter.state]);

  // Het live beeld van Anam is in beeld (of komt eraan): verbonden, spreekt of gepauzeerd.
  const liveNow =
    realAvatar &&
    ["loading", "speaking", "paused", "ready"].includes(presenter.state);
  useEffect(() => {
    if (!liveNow) return setRestGone(false);
    const t = setTimeout(() => setRestGone(true), REST_FADE_MS + 100);
    return () => clearTimeout(t);
  }, [liveNow]);

  // Na de uitleg van een woord: verder waar Nova was, als dat bericht nog in beeld is.
  useEffect(() => {
    const current = aside.current;
    if (!current) return;
    if (presenter.state === "speaking") current.started = true;
    if (!current.started || presenter.state !== "ready") return;
    endAside();
    if (current.resume && current.resume.fragment === fragment) {
      presenter.speak(current.resume.fragment.sentences, undefined, current.resume.from);
    }
    // presenter is elke render een nieuw object; alleen de status telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenter.state, fragment]);

  function start() {
    if (started || !article) return;
    setStarted(true);
    explain(article, "core", undefined, []);
  }

  // Volgend bericht: oude uitleg stopt, een laat antwoord wordt genegeerd en de context van het
  // vorige bericht gaat weg. Pas daarna de kern van het nieuwe bericht.
  function next() {
    if (!started || homeCount === 0) return;
    selectArticle(index + 1 < homeCount ? index + 1 : 0);
  }

  function selectArticle(nextIndex: number) {
    if (!articles[nextIndex] || (started && nextIndex === index)) return;
    seq.current++;
    inflight.current?.abort();
    inflight.current = null;
    waiting.current = null;
    presenter.stop();
    setSelectedId(articles[nextIndex].id);
    endAside();
    setFragment(null);
    setTranscript(false);
    setHistory([]);
    setProblem(null);
    setPanel(null);
    if (started) explain(articles[nextIndex], "core", undefined, []);
  }

  function action(a: Action) {
    if (blocked || !article) return;
    explain(article, a);
  }

  function togglePlayback() {
    if (speaking) presenter.pause();
    else if (paused) presenter.resume();
    else if (fragment && !preparing) presenter.replay();
  }

  function again() {
    if (blocked || !fragment) return;
    presenter.replay();
  }

  // Woord aangetikt: Nova legt het uit, en gaat daarna verder bij de zin waar ze was.
  function explainWord(word: HardWord) {
    if (!fragment || preparing) return;
    const telling = speaking || paused;
    aside.current = {
      resume: telling ? { fragment, from: Math.max(0, presenter.sentence) } : null,
      started: false,
    };
    setAsideWord(word);
    presenter.speak([spokenExplanation(word)]);
  }

  function endAside() {
    aside.current = null;
    setAsideWord(null);
  }

  function ask(question: string) {
    if (!question || preparing || inflight.current || !article) return;
    // A question can also start the conversation, without an opening summary.
    if (!started) setStarted(true);
    setPanel(null);
    setDraft("");
    explain(article, "question", question, started ? history : []);
  }
  askRef.current = ask;

  function submit(e: FormEvent) {
    e.preventDefault();
    setHeard("");
    ask(draft.trim());
  }

  // Microfoon aan tot de vraag af is (Anam meldt het einde), of tot je nog een keer tikt.
  function toggleListen() {
    if (presenter.listening === "on") return presenter.stopListening();
    if (preparing || !article) return;
    setHeard("");
    setPanel(null);
    presenter.listen();
  }

  const close = useCallback(() => setPanel(null), []);

  // ---------- wat er in beeld staat ----------

  let status: { text: string; tone?: "busy" | "problem" };
  if (!config)
    status = loadFailed
      ? { text: "Laden lukt niet. Probeer opnieuw.", tone: "problem" }
      : { text: "Even laden", tone: "busy" };
  else if (!article)
    status = {
      text: "Er is nu geen nieuws. Probeer het later opnieuw.",
      tone: "problem",
    };
  else if (!started) status = { text: "Klaar om te starten" };
  else if (problem) status = { text: problem.message, tone: "problem" };
  else if (preparing)
    status = { text: `Even laden. ${PREPARING[preparing]}`, tone: "busy" };
  else if (presenter.state === "connecting")
    status = { text: "Verbinding maken. Even laden.", tone: "busy" };
  else if (presenter.state === "loading")
    status = { text: "Even laden.", tone: "busy" };
  else if (presenter.state === "speaking") status = { text: "Nova vertelt" };
  else if (presenter.state === "paused")
    status = { text: presenter.detail || "Gepauzeerd" };
  else if (presenter.state === "disconnected")
    status = {
      text:
        presenter.detail === "idle" || presenter.detail === "hidden"
          ? "De verbinding is gestopt omdat je even weg was. Kies een knop om verder te gaan."
          : "Verbinding verbroken. Probeer opnieuw.",
      tone: "problem",
    };
  else if (presenter.state === "error")
    status = {
      text: presenter.detail || "Verbinding verbroken. Probeer opnieuw.",
      tone: "problem",
    };
  else status = { text: "Uitgekeken · ontdek meer over dit bericht" };

  const published = article && nlDate(article.published);
  const updated = article && nlDate(article.updated);
  const showVideo = realAvatar;
  const live = liveNow;
  // Het wachtbeeld vervaagt in REST_FADE_MS zodra het live beeld er is, en gaat daarna weg.
  const restFade: CSSProperties = {
    opacity: live ? 0 : 1,
    transition: `opacity ${REST_FADE_MS}ms ease`,
    pointerEvents: "none",
  };
  const timingLabel =
    presenter.timing === "sentence"
      ? "Ondertiteling"
      : presenter.timing === "simulated"
          ? "Ondertiteling (gesimuleerd tempo)"
          : "Meeleestekst";

  // Zonder timing per zin blijft de hele tekst als meeleestekst onder het beeld staan; alleen
  // presentatoren met timing per zin krijgen wisselende ondertiteling in beeld.
  const timedCaptions = presenter.timing !== "none";
  // Tijdens de uitleg van een woord gaat de zin-teller over die uitleg, niet over het bericht.
  const spokenIndex = asideWord ? -1 : presenter.sentence;
  const linked = useMemo(() => (fragment ? linkWords(fragment.sentences, fragment.words ?? []) : []), [fragment]);
  const activeIndex = presenter.sentence >= 0 ? presenter.sentence : 0;
  const activeSentence = asideWord ? spokenExplanation(asideWord) : fragment?.sentences[activeIndex];

  return (
    <div className="app">
      <header className="header">
        <p className="brand">
          <span className="brand-name">Nova</span>
          <span className="brand-tagline">Nieuws in duidelijke taal</span>
        </p>
        <nav className="header-tools" aria-label="Instellingen">
          <button
            type="button"
            className="btn header-tool"
            aria-label={largeText ? "Normale tekstgrootte" : "Grotere tekst"}
            aria-pressed={largeText}
            onClick={() => setLargeText(!largeText)}
          >
            <TextSizeIcon />
            <span>Tekstgrootte</span>
          </button>
          <button
            type="button"
            className="btn header-tool"
            onClick={() => setPanel("access")}
            aria-label="Toegankelijkheid"
          >
            <AccessibilityIcon />
            <span>Toegankelijkheid</span>
          </button>
        </nav>
      </header>

      <main className={`layout${started ? " is-started" : ""}`}>
        <section className="stage" aria-label="Presentator">
          {article && <h1 className="stage-title">{article.shortTitle}</h1>}
          <div className="frame">
            <PresenterBackdrop poster={config?.poster ?? null} />
            {showVideo && (
              <video
                ref={presenter.video}
                className="frame-media"
                autoPlay
                playsInline
                disablePictureInPicture
                aria-hidden={!live}
                aria-label="Nova, de AI-presentator"
              />
            )}
            {/* Vóór Start: de wachtvideo van de avatar (een gewoon videobestand, geen stream en geen
                kosten), zodat de presentator al beweegt. Anders de foto. Die ligt óver het live
                beeld en vervaagt pas als dat er is: geen harde wissel tussen bestand en stream. */}
            {!restGone &&
              (config?.idleVideo ? (
                <video
                  className="frame-media"
                  style={restFade}
                  src={config.idleVideo}
                  poster={config.poster ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                  disablePictureInPicture
                  aria-hidden={live}
                  aria-label="Nova, de AI-presentator"
                />
              ) : config?.poster ? (
                <img
                  className="frame-media"
                  style={restFade}
                  src={config.poster}
                  alt={live ? "" : "Nova, de AI-presentator"}
                />
              ) : live ? null : (
                <div className="frame-empty" aria-hidden="true">
                  <span className="placeholder-mark">Nova</span>
                  <span>Je nieuws, helder verteld.</span>
                </div>
              ))}
            <p className="ai-label">
              <span className="on-air-dot" /> AI-presentator
            </p>
            {config?.avatarMode === "simulated" && (
              <p className="sim-label">Gesimuleerde preview</p>
            )}
            {/* De afbeelding van het bericht schuin boven Nova's schouder, zoals bij het journaal.
                Een nieuw bericht (key) laat de afbeelding opnieuw invloeien. */}
            {article?.image && (
              <figure key={article.id} className="frame-ots" aria-hidden="true">
                <img src={article.image} alt="" referrerPolicy="no-referrer" />
                <figcaption>{article.publisher}</figcaption>
              </figure>
            )}
          </div>
          {/* Ondertiteling met timing alleen zolang Nova praat (of gepauzeerd is): na de laatste zin
              verdwijnt ze. De hele tekst blijft te lezen in "Nova vertelt". */}
          {fragment && captions && (!timedCaptions || (activeSentence && (speaking || presenter.state === "paused"))) && (
            <p
              className={`stage-caption${timedCaptions ? "" : " is-reading"}`}
              aria-label={timingLabel}
            >
              {asideWord ? (
                spokenExplanation(asideWord)
              ) : timedCaptions ? (
                // Gewone tekst: de moeilijke woorden zijn aan te tikken in "Nova vertelt".
                fragment.sentences[activeIndex]
              ) : (
                fragment.spoken
              )}
            </p>
          )}
          <div className="stage-toolbar">
            <div className="playback">
              {!started ? (
                <button
                  type="button"
                  className="btn btn-primary btn-start"
                  disabled={!article}
                  onClick={start}
                >
                  <PlayIcon />
                  Start nieuws
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!preparing || !fragment}
                    onClick={togglePlayback}
                  >
                    {speaking ? <PauseIcon /> : <PlayIcon />}
                    {speaking ? "Pauze" : paused ? "Verder" : "Afspelen"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={blocked || !fragment}
                    onClick={again}
                  >
                    <AgainIcon />
                    <span>Nog een keer</span>
                  </button>
                </>
              )}
            </div>
            <p
              className={`status${status.tone ? ` status-${status.tone}` : ""}`}
              role="status"
              aria-live="polite"
            >
              {status.tone === "busy" && (
                <span className="pulse" aria-hidden="true" />
              )}
              {status.text}
            </p>
            <button
              type="button"
              className="btn captions-toggle"
              aria-label={
                captions ? "Ondertiteling uitzetten" : "Ondertiteling aanzetten"
              }
              aria-pressed={captions}
              onClick={toggleCaptions}
            >
              <CaptionsIcon />
              <span>Ondertiteling {captions ? "aan" : "uit"}</span>
            </button>
          </div>
          {problem?.retry && !preparing && (
            <button type="button" className="btn retry" onClick={problem.retry}>
              <AgainIcon />
              Probeer opnieuw
            </button>
          )}
          {loadFailed && (
            <button type="button" className="btn retry" onClick={loadConfig}>
              <AgainIcon />
              Probeer opnieuw
            </button>
          )}
        </section>

        <section
          className={`reader${fragment && timedCaptions ? " has-overlay" : ""}`}
          aria-label="Uitleg bij het nieuws"
        >
          <section className="question-card" aria-labelledby="question-title">
            <h2 id="question-title">
              <AskIcon />
              Stel zelf een vraag
            </h2>
            <p className="question-intro">
              Wat wil jij weten over dit bericht?
            </p>
            <form className="question-composer" onSubmit={submit}>
              <label className="sr-only" htmlFor="inline-question">
                Jouw vraag over dit bericht
              </label>
              <input
                id="inline-question"
                value={draft}
                placeholder="Typ hier je vraag…"
                autoComplete="off"
                enterKeyHint="send"
                maxLength={300}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!draft.trim() || !!preparing || !article}
              >
                <SendIcon />
                Vraag Nova
              </button>
            </form>
            <button
              type="button"
              className="question-launcher"
              aria-label="Stel zelf een vraag"
              aria-haspopup="dialog"
              disabled={!!preparing || !article}
              onClick={() => setPanel("ask")}
            >
              <span>{draft || "Wat wil je weten?"}</span>
              <SendIcon />
            </button>
            {presenter.canListen && (
              <MicButton
                listening={presenter.listening}
                disabled={!!preparing || !article}
                onClick={toggleListen}
              />
            )}
            {heard && <p className="question-privacy">Je vroeg: “{heard}”</p>}
            <p className="question-privacy">
              Zeg of typ geen persoonlijke gegevens.
            </p>
          </section>
          <div className="reading-card">
            {fragment ? (
              <>
                <p className="reading-label">
                  {timedCaptions ? "Nova vertelt" : "Meeleestekst"}
                </p>
                {asideWord && (
                  <p className="reading-label" role="status">
                    Uitleg: {asideWord.word}. {asideWord.explanation}
                  </p>
                )}
                <div className="captions-text">
                  {fragment.sentences.map((_, i) => (
                    <p
                      key={i}
                      className={i === spokenIndex ? "is-spoken" : undefined}
                    >
                      <Linked segments={linked[i] ?? []} onWord={explainWord} />
                    </p>
                  ))}
                </div>
                <button
                  type="button"
                  className="transcript-toggle"
                  aria-expanded={transcript}
                  onClick={() => setTranscript(!transcript)}
                >
                  Lees volledige tekst
                  <MoreIcon />
                </button>
                {fragment.mode === "fallback" && (
                  <p className="captions-note">
                    De AI werkt nu niet. Je hoort zinnen uit het bericht zelf.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="reading-label">Het nieuws, op jouw tempo</p>
                <p>
                  {article
                    ? "Stel je vraag aan Nova, of start eerst het nieuws."
                    : config
                      ? "Er is nu geen nieuws beschikbaar. Probeer het later opnieuw."
                      : "De nieuwsselectie wordt geladen."}
                </p>
              </>
            )}
          </div>
          <div className="controls" role="group" aria-label="Meer uitleg">
            {EXPLAIN.map(({ action: a, label, icon }) => (
              <button
                key={a}
                type="button"
                className="btn"
                disabled={blocked}
                onClick={() => action(a)}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              className="btn control-next"
              disabled={!started}
              onClick={next}
            >
              <NextIcon />
              <span>
                {index >= homeCount - 1
                  ? "Terug naar bericht 1"
                  : "Volgend bericht"}
              </span>
            </button>
          </div>
          <div className="source-line">
            {article && (
              <>
                <p>
                  Bron: <strong>{article.publisher}</strong>
                  {published && <> · {published}</>}
                  {updated && <> · bijgewerkt {updated}</>}
                </p>
                <button
                  type="button"
                  className="btn btn-source"
                  onClick={() => setPanel("source")}
                >
                  Bekijk bron
                  <ExternalIcon />
                </button>
              </>
            )}
            <p className="ai-note">
              <span aria-hidden="true">✧</span> Uitleg gemaakt met AI
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>Nova · Nieuws in duidelijke taal</span>
        <div className="footer-tools">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setPanel("news")}
          >
            <NewsIcon />
            <span className="desktop-label">Ander nieuws</span>
            <span className="mobile-label">Nieuws</span>
          </button>
          {article && (
            <button
              type="button"
              className="btn btn-quiet mobile-source"
              aria-label="Bekijk bron"
              onClick={() => setPanel("source")}
            >
              Bron
            </button>
          )}
          {fragment && (
            <button
              type="button"
              className="btn btn-quiet mobile-transcript"
              onClick={() => setTranscript(true)}
            >
              <span aria-label="Volledige tekst">Tekst</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setPanel("help")}
          >
            <span className="desktop-label">Hoe werkt Nova?</span>
            <span className="mobile-label">Hulp</span>
          </button>
          {config?.devTools && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setPanel("dev")}
            >
              Testopties
            </button>
          )}
        </div>
      </footer>
      <Panel open={panel === "news"} onClose={close} title="Ander nieuws">
        <section className="today" aria-labelledby="today-title">
          <div className="section-heading">
            <h2 id="today-title">
              {config?.newsMode === "test" ? "In deze selectie" : "Vandaag"}
            </h2>
            <span>
              {!homeCount
                ? "Nieuws"
                : index < homeCount
                  ? `${index + 1} van ${homeCount}`
                  : "Nu: buitenland"}
            </span>
          </div>
          <div className="story-list">
            {articles.map((item, i) => (i < homeCount || i === index) && (
              <button
                type="button"
                key={item.id}
                className={`story-card${i === index ? " is-selected" : ""}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => selectArticle(i)}
              >
                <span
                  className={`story-art${item.image ? " has-image" : ""}`}
                  aria-hidden="true"
                >
                  {item.image ? (
                    <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <NewsIcon />
                  )}
                  <span>{i < homeCount ? String(i + 1).padStart(2, "0") : "BL"}</span>
                </span>
                <span className="story-publisher">
                  {item.publisher}
                  <span>{i === index ? "Nu in beeld" : "Bekijk bericht"}</span>
                </span>
                <span className="story-title">{item.shortTitle}</span>
              </button>
            ))}
          </div>
        </section>
      </Panel>
      <Panel
        open={transcript}
        onClose={() => setTranscript(false)}
        title="Volledige tekst"
      >
        <div className="transcript-body">
          {fragment?.sentences.map((_, i) => (
            <p key={i} className={i === spokenIndex ? "is-spoken" : undefined}>
              <Linked segments={linked[i] ?? []} onWord={explainWord} />
            </p>
          ))}
        </div>
      </Panel>
      <Panel open={panel === "dev"} onClose={close} title="Testopties">
        {config?.devTools && (
          <DevPanel
            config={config}
            fragment={fragment}
            presenterState={presenter.state}
            simulate={simulate}
            onSimulate={setSimulate}
            onDrop={presenter.simulateDrop}
          />
        )}
      </Panel>

      <Panel
        open={panel === "access"}
        onClose={close}
        title="Toegankelijkheid"
        size="compact"
      >
        <div className="access-settings">
          <p>Stel Nova in zoals jij prettig vindt.</p>
          <button
            type="button"
            className="btn"
            aria-pressed={largeText}
            onClick={() => setLargeText(!largeText)}
          >
            <TextSizeIcon />
            Grotere tekst: {largeText ? "aan" : "uit"}
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={captions}
            onClick={toggleCaptions}
          >
            <CaptionsIcon />
            Ondertiteling: {captions ? "aan" : "uit"}
          </button>
          <p>
            Je kunt altijd meelezen, pauzeren en de uitleg opnieuw afspelen.
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setPanel("help")}
          >
            Hoe werkt Nova?
          </button>
        </div>
      </Panel>

      <Panel
        open={panel === "ask"}
        onClose={close}
        title="Stel zelf een vraag"
        size="compact"
      >
        <form className="ask-form" onSubmit={submit}>
          <label htmlFor="question">Typ een korte vraag over dit bericht</label>
          <input
            id="question"
            data-autofocus
            value={draft}
            autoComplete="off"
            enterKeyHint="send"
            maxLength={300}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p>Je vraag gaat over: {article?.shortTitle}</p>
          {presenter.canListen && (
            <MicButton
              listening={presenter.listening}
              disabled={!!preparing || !article}
              onClick={toggleListen}
            />
          )}
          <p>
            Typ geen persoonlijke gegevens. Je vraag gaat naar een AI-taalmodel
            (via Groq) en wordt niet bewaard.
          </p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!draft.trim() || !!preparing || !article}
          >
            <SendIcon />
            Vraag Nova
          </button>
        </form>
      </Panel>

      <Panel open={panel === "source"} onClose={close} title="Bron">
        {article && (
          <div className="source">
            {article.image && (
              <img className="source-image" src={article.image} alt="" referrerPolicy="no-referrer" />
            )}
            <p>
              <strong>{article.title}</strong>
            </p>
            <p>
              Bron: <strong>{article.publisher}</strong>
            </p>
            {published && <p>Gepubliceerd: {published}</p>}
            {updated && <p>Bijgewerkt: {updated}</p>}
            <a
              className="link"
              href={article.url}
              target="_blank"
              rel="noreferrer"
              data-autofocus
            >
              {hostname(article.url)
                ? `Open het bericht op ${hostname(article.url)}`
                : "Open het bericht"}
              <ExternalIcon />
              <span className="sr-only"> (opent in een nieuw tabblad)</span>
            </a>
            <p>Nova vertelt alleen wat in dit bericht staat.</p>
            <p>Nova is geen dienst van de {article.publisher}.</p>
          </div>
        )}
      </Panel>

      <Panel open={panel === "help"} onClose={close} title="Hoe werkt dit?">
        <div className="help">
          <section>
            <h3>Wat is Nova?</h3>
            <p>
              <strong>Nova is een AI-presentator. Nova is geen mens.</strong>
            </p>
            <p>De tekst maakt een computer met AI (Qwen, via Groq).</p>
            <p>Het beeld en de stem maakt Anam, ook met AI.</p>
            <p>
              Stel je een vraag met je stem, dan maakt Anam daar tekst van. Je
              stem wordt niet door ons bewaard.
            </p>
          </section>
          <section>
            <h3>Waar komt het nieuws vandaan?</h3>
            <p>
              Nova vertelt over Nederlands nieuws van vandaag, van de NOS. Nova
              gebruikt alleen wat in die berichten staat. Vraag je naar een
              ander bericht, dan gaat Nova naar dat bericht. Vraag je naar
              nieuws uit het buitenland, dan vertelt Nova daar ook over.
            </p>
            <p>
              Bij elk bericht staat de bron. Met ‘Bekijk bron’ lees je het hele
              bericht.
            </p>
            <p>
              <strong>AI kan fouten maken.</strong> Twijfel je? Lees dan het
              bericht bij de bron.
            </p>
          </section>
          <section>
            <h3>Welke knoppen zijn er?</h3>
            <p>
              <strong>Pauze en Verder:</strong> Nova stopt even, en gaat daarna
              verder.
            </p>
            <p>
              <strong>Nog een keer:</strong> je hoort de laatste uitleg opnieuw.
            </p>
            <p>
              <strong>Leg makkelijker uit:</strong> dezelfde uitleg, met
              makkelijkere woorden.
            </p>
            <p>
              <strong>Wat betekent dit?</strong> Nova legt het belangrijkste
              woord of gevolg uit.
            </p>
            <p>
              <strong>Vertel meer:</strong> Nova vertelt meer over de
              achtergrond.
            </p>
            <p>
              <strong>Stel een vraag:</strong> je typt zelf een korte vraag over
              dit bericht.
            </p>
            <p>
              <strong>Volgend bericht:</strong> Nova stopt en vertelt het
              volgende bericht.
            </p>
            <p>
              <strong>Ondertiteling:</strong> de tekst van Nova staat in beeld,
              of niet.
            </p>
          </section>
          <section>
            <h3>Wat gebeurt er met mijn gegevens?</h3>
            <p>Je hebt geen account nodig.</p>
            <p>Je vragen en de antwoorden worden niet bewaard.</p>
          </section>
        </div>
      </Panel>
    </div>
  );
}

// Alleen voor ontwikkelaars: foutsimulatie, versies van het laatste antwoord en het verbruik.
function DevPanel({
  config,
  fragment,
  presenterState,
  simulate,
  onSimulate,
  onDrop,
}: {
  config: Config;
  fragment: Fragment | null;
  presenterState: string;
  simulate: Simulate;
  onSimulate: (s: Simulate) => void;
  onDrop: () => void;
}) {
  return (
    <details className="dev">
      <summary>Voor ontwikkelaars</summary>
      <dl>
        <dt>Avatar</dt>
        <dd>
          {config.avatarMode === "anam"
            ? "Anam (echte stream, kost Anam-minuten)"
            : "gesimuleerd (geen Anam)"}
        </dd>
        <dt>Nieuws</dt>
        <dd>
          {config.newsMode === "test"
            ? "vaste testselectie"
            : "NOS Binnenland en Politiek (vandaag)"}
        </dd>
        <dt>Presentator</dt>
        <dd>{presenterState}</dd>
        <dt>Promptversie</dt>
        <dd>{fragment?.promptVersion ?? config.promptVersion}</dd>
        {fragment && (
          <>
            <dt>Artikelversie</dt>
            <dd>{fragment.articleVersion}</dd>
            <dt>Antwoord</dt>
            <dd>
              {fragment.mode === "ai" ? "AI-taalmodel" : "terugval (regels)"} ·{" "}
              {fragment.requestId.slice(0, 8)}
            </dd>
          </>
        )}
      </dl>
      <div className="dev-actions">
        <button
          type="button"
          className="btn"
          aria-pressed={simulate === "gemini-error"}
          onClick={() => onSimulate("gemini-error")}
        >
          Volgende vraag: Gemini-fout
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={simulate === "server-error"}
          onClick={() => onSimulate("server-error")}
        >
          Volgende vraag: serverfout
        </button>
        <button type="button" className="btn" onClick={onDrop}>
          Verbinding verbreken
        </button>
      </div>
    </details>
  );
}

// Spreek je vraag in (alleen met Anam). De microfoon staat alleen aan zolang deze knop "luistert".
function MicButton({
  listening,
  disabled,
  onClick,
}: {
  listening: ListenState;
  disabled: boolean;
  onClick: () => void;
}) {
  const on = listening === "on";
  return (
    <>
      <button
        type="button"
        className={`btn${on ? " btn-primary" : ""}`}
        aria-pressed={on}
        disabled={disabled && !on}
        onClick={onClick}
      >
        <MicIcon />
        {on ? "Ik luister… tik als je klaar bent" : "Spreek je vraag in"}
      </button>
      {listening === "denied" && (
        <p className="question-privacy" role="alert">
          Nova mag de microfoon niet gebruiken. Zet het aan in je browser, of
          typ je vraag.
        </p>
      )}
      {listening === "failed" && (
        <p className="question-privacy" role="alert">
          De microfoon werkt nu niet. Typ je vraag.
        </p>
      )}
    </>
  );
}

// Een zin met moeilijke woorden als link: aantikken en Nova legt het woord uit.
const WORD_LINK: CSSProperties = {
  font: "inherit",
  color: "inherit",
  background: "none",
  border: 0,
  padding: 0,
  textDecoration: "underline",
  textDecorationThickness: "2px",
  textUnderlineOffset: "0.18em",
  cursor: "pointer",
};

function Linked({
  segments,
  onWord,
}: {
  segments: Segment[];
  onWord: (word: HardWord) => void;
}) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.word ? (
          <button
            key={i}
            type="button"
            style={WORD_LINK}
            aria-label={`Wat betekent ${segment.word.word}? Nova legt het uit.`}
            onClick={() => onWord(segment.word!)}
          >
            {segment.text}
          </button>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
