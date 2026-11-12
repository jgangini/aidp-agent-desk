import { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element, Root } from "hast";
import { StreamingText } from "./StreamingText";
import { mentionTokens, queryRanges } from "./MentionText";
import "./MarkdownText.css";

function streamLeaves({ query = "" }: { query?: string } = {}) {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index];
        if (child.type === "text" && child.value.trim()) {
          const value = child.value;
          const ranges = queryRanges(value, query);
          let rangeIndex = 0;
          const segments: Element[] = mentionTokens(value).flatMap((token) => {
            const children: Element[] = [];
            let cursor = token.start;
            while (cursor < token.end) {
              while (
                rangeIndex < ranges.length &&
                ranges[rangeIndex].end <= cursor
              )
                rangeIndex++;
              const range = ranges[rangeIndex];
              const matched = !!range && range.start <= cursor;
              const end = Math.min(
                token.end,
                range ? (matched ? range.end : range.start) : token.end,
              );
              const stream: Element = {
                type: "element",
                tagName: "span",
                properties: { "data-stream-text": true },
                children: [{ type: "text", value: value.slice(cursor, end) }],
              };
              children.push(
                matched
                  ? {
                      type: "element",
                      tagName: "mark",
                      properties: { className: ["result-match"] },
                      children: [stream],
                    }
                  : stream,
              );
              cursor = end;
            }
            return token.mention
              ? [
                  {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["user-mention"] },
                    children,
                  },
                ]
              : children;
          });
          parent.children.splice(index, 1, ...segments);
          index += segments.length - 1;
        } else if (
          child.type === "element" &&
          !["code", "pre"].includes(child.tagName)
        )
          walk(child);
      }
    };
    walk(tree);
  };
}

function linkUrl(value: string) {
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return value;
  } catch {
    /* Relative and malformed destinations are not agent citations. */
  }
  return undefined;
}

export function MarkdownText({
  text,
  live,
  animateInitial = false,
  query = "",
  compact = false,
  links = true,
}: {
  text: string;
  live: boolean;
  animateInitial?: boolean;
  query?: string;
  compact?: boolean;
  links?: boolean;
}) {
  const components = useMemo<Components>(
    () => ({
      span: ({ node, children, className }) => {
        const child = node?.children[0];
        return node?.properties["data-stream-text"] &&
          child?.type === "text" ? (
          <StreamingText
            text={child.value}
            live={live}
            animateInitial={animateInitial}
          />
        ) : (
          <span className={className}>{children}</span>
        );
      },
      a: ({ href, children }) =>
        links && href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <>{children}</>
        ),
    }),
    [live, animateInitial, links],
  );
  return (
    <div
      className={`t-stream markdown-text${compact ? " markdown-text-compact" : ""}`}
      data-status={live ? "running" : "complete"}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[streamLeaves, { query }]]}
        skipHtml
        disallowedElements={["img"]}
        urlTransform={linkUrl}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
