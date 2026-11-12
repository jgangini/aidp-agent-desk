import { Fragment, type ReactNode } from "react";
import "./MentionText.css";

export interface MentionToken {
  text: string;
  start: number;
  end: number;
  mention: boolean;
}

export function mentionTokens(text: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const pattern =
    /(?<![\p{L}\p{N}\p{M}_.])@[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*(?:\.[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*)*/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor)
      tokens.push({
        text: text.slice(cursor, match.index),
        start: cursor,
        end: match.index,
        mention: false,
      });
    const end = match.index + match[0].length;
    tokens.push({ text: match[0], start: match.index, end, mention: true });
    cursor = end;
  }
  if (cursor < text.length)
    tokens.push({
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
      mention: false,
    });
  return tokens;
}

const folded = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");

export function queryRanges(text: string, query: string) {
  const search = folded(query.trim());
  if (!search) return [];
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const value = folded(character);
    const end = offset + character.length;
    if (!value && ends.length) ends[ends.length - 1] = end;
    for (let index = 0; index < value.length; index++) {
      starts.push(offset);
      ends.push(end);
    }
    normalized += value;
    offset = end;
  }
  const ranges: { start: number; end: number }[] = [];
  for (
    let index = normalized.indexOf(search);
    index !== -1;
    index = normalized.indexOf(search, index + search.length)
  )
    ranges.push({ start: starts[index], end: ends[index + search.length - 1] });
  return ranges;
}

export function MentionText({
  text,
  query = "",
}: {
  text: string;
  query?: string;
}) {
  const ranges = queryRanges(text, query);
  let rangeIndex = 0;
  return (
    <>
      {mentionTokens(text).map((token) => {
        const children: ReactNode[] = [];
        let cursor = token.start;
        while (cursor < token.end) {
          while (rangeIndex < ranges.length && ranges[rangeIndex].end <= cursor)
            rangeIndex++;
          const range = ranges[rangeIndex];
          if (!range || range.start >= token.end) {
            children.push(text.slice(cursor, token.end));
            break;
          }
          if (cursor < range.start) {
            children.push(text.slice(cursor, range.start));
            cursor = range.start;
          }
          const end = Math.min(token.end, range.end);
          children.push(
            <mark key={cursor} className="result-match">
              {text.slice(cursor, end)}
            </mark>,
          );
          cursor = end;
        }
        return (
          <Fragment key={token.start}>
            {token.mention ? (
              <span className="user-mention">{children}</span>
            ) : (
              children
            )}
          </Fragment>
        );
      })}
    </>
  );
}
