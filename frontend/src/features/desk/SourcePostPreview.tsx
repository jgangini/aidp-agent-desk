import { useState } from "react";
import type { Reference } from "./publicManifest";
import { MentionText } from "./MentionText";
import {
  postTitle,
  postAuthor,
  postContent,
  postPublished,
} from "./sourcePostMetadata";

export function SourcePostPreview({
  reference,
  index,
}: {
  reference: Reference | undefined;
  index: number;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const media =
    reference?.media?.filter(
      (asset) => asset.delivery === "direct" && !failed.includes(asset.url),
    ) ?? [];
  const images = media.filter((asset) => asset.kind === "image");
  const preview =
    images.find((asset) => asset.role === "thumbnail") ?? images.at(0);
  const date = reference && postPublished(reference);
  const videoPreview =
    !preview && media.find((asset) => asset.kind === "video");

  const markFailed = (url: string) =>
    setFailed((prior) => (prior.includes(url) ? prior : [...prior, url]));

  return reference ? (
    <div className="source-post-stage">
      <a
        className="source-post-preview"
        data-tooltip-disabled="true"
        href={reference.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${postAuthor(reference) ?? "Usuario no identificado"} · ${postTitle(reference, index)} (abre en una pestaña nueva)`}
      >
        {preview && (
          <img
            key={preview.url}
            src={preview.url}
            alt={
              typeof preview.alt === "string"
                ? preview.alt
                : `Imagen de ${postTitle(reference, index)}`
            }
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => markFailed(preview.url)}
          />
        )}
        {videoPreview && (
          <video
            key={videoPreview.url}
            className="source-post-video-preview"
            src={`${videoPreview.url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            disablePictureInPicture
            tabIndex={-1}
            aria-hidden="true"
            onError={() => markFailed(videoPreview.url)}
          />
        )}
        <span className="source-post-caption">
          <strong>
            <MentionText
              text={postAuthor(reference) ?? "Usuario no identificado"}
            />
          </strong>
          {date && <time dateTime={date.value}>{date.label}</time>}
          {postContent(reference) && (
            <span className="source-post-text">
              <MentionText text={postContent(reference)!} />
            </span>
          )}
        </span>
      </a>
    </div>
  ) : null;
}
