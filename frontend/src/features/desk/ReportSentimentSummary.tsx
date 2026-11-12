import type { Sentiment } from "./reportExtensions";
import "./ReportSentimentSummary.css";

const labels = {
  positive: "Positivo",
  neutral: "Neutral",
  negative: "Negativo",
  mixed: "Mixto",
};
const categories = ["positive", "neutral", "negative", "mixed"] as const;

export function ReportSentimentSummary({
  sentiment,
}: {
  sentiment: Sentiment;
}) {
  const summaries = new Map<string, Sentiment["groups"][number]>();
  for (const group of sentiment.groups) {
    const key = JSON.stringify([group.target, group.aspect, group.basis]);
    const previous = summaries.get(key);
    if (!previous) {
      summaries.set(key, { ...group, counts: { ...group.counts } });
      continue;
    }
    previous.eligible_count += group.eligible_count;
    previous.classified_count += group.classified_count;
    previous.unclassified_count += group.unclassified_count;
    for (const category of categories)
      previous.counts[category] += group.counts[category];
  }
  return (
    <div className="report-sentiment-summary">
      {[...summaries].map(([key, group]) => (
        <figure key={key}>
          <figcaption>
            <strong>
              {group.target}
              {group.aspect ? ` · ${group.aspect}` : ""}
            </strong>
            <span>
              {group.basis === "comment_text" ? "Comentarios" : "Publicaciones"}{" "}
              · {group.classified_count} clasificados de {group.eligible_count}{" "}
              elegibles · {group.unclassified_count} sin clasificar
            </span>
          </figcaption>
          {group.classified_count > 0 && (
            <>
              <p className="report-note">
                Porcentaje de los textos clasificados · escala de 0 a 100 %
              </p>
              <ul
                className="report-sentiment-chart report-sentiment-columns"
                aria-label={`Distribución de sentimiento de ${group.target}`}
              >
                {categories.map((category) => {
                  const percent =
                    (100 * group.counts[category]) / group.classified_count;
                  return (
                    <li key={category}>
                      <span
                        className="sentiment-column-track"
                        aria-hidden="true"
                      >
                        <span
                          className={`sentiment-${category}`}
                          style={{ height: `${percent}%` }}
                        />
                      </span>
                      <strong>{labels[category]}</strong>
                      <span>
                        {group.counts[category]} · {Math.round(percent)} %
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </figure>
      ))}
    </div>
  );
}
