import type { Article } from '@/lib/news';

function nlDate(iso: string) {
  return new Date(iso).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Het beeld van de presentator. Kent geen chat- of nieuwslogica: alleen of Nova
// bezig is en welk artikel actief is. Hier komt later de realtime avatar (bijv.
// HeyGen LiveAvatar) in de plaats van het "N"-gezicht, met een extra prop `text`
// die de avatar uitspreekt.
export function AnchorStage({ busy, article }: { busy: boolean; article: Article | null }) {
  return (
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

      <div className="lower-third" key={article?.id ?? 'briefing'}>
        <span className="lt-name">Nova, nieuwspresentator</span>
        <span className="lt-source">
          {article ? (
            <>
              {article.source}, {nlDate(article.published)}
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                bron openen
              </a>
            </>
          ) : (
            'Het nieuws van vandaag'
          )}
        </span>
      </div>
    </div>
  );
}
