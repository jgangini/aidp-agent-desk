import { useState } from "react";
import type { Reference, ReferenceMedia } from "./publicManifest";
import { reportReferenceLabel } from "./reportReferenceLabel";
export function ReportMedia({ references }: { references: Reference[] }) {
  if (
    !references.some((ref) =>
      ref.media?.some((media) => media.kind === "image"),
    )
  )
    return null;
  return (
    <section className="report-section">
      <h2>Medios de evidencia</h2>
      <div className="report-media">
        {references.flatMap(
          (ref, index) =>
            ref.media
              ?.filter((m) => m.kind === "image")
              .map((media) => (
                <figure key={`${ref.evidence_id}-${media.url}`}>
                  {media.delivery === "direct" ? (
                    <div className="report-media-frame">
                      <EvidenceImage
                        media={media}
                        label={reportReferenceLabel(ref)}
                        sourceUrl={ref.url}
                      />
                    </div>
                  ) : (
                    <a
                      href={media.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir imagen en la fuente
                    </a>
                  )}
                  <figcaption>
                    <a href={ref.url} target="_blank" rel="noopener noreferrer">
                      [{index + 1}] {reportReferenceLabel(ref)}
                    </a>
                  </figcaption>
                </figure>
              )) ?? [],
        )}
      </div>
    </section>
  );
}
function EvidenceImage({
  media,
  label,
  sourceUrl,
}: {
  media: ReferenceMedia;
  label: string;
  sourceUrl: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
      Imagen no disponible. Abrir fuente
    </a>
  ) : (
    <img
      src={media.url}
      loading="lazy"
      referrerPolicy="no-referrer"
      alt={label}
      onError={() => setFailed(true)}
    />
  );
}
