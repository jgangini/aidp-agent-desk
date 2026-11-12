import { useState } from "react";

interface Word {
  text: string;
  offset: number;
  enter: boolean;
  delay: number;
}

function words(text: string, enter: boolean, previous?: Word[], after = 0) {
  let added = 0;
  return [...text.matchAll(/\s+|\S+/gu)].map((match, index): Word => {
    const offset = match.index;
    const prior = previous?.[index];
    const fresh = enter && offset >= after && /\S/u.test(match[0]);
    return {
      text: match[0],
      offset,
      enter: fresh || (enter && !!prior?.enter),
      delay: fresh ? Math.min(added++ * 60, 240) : (prior?.delay ?? 0),
    };
  });
}

export function StreamingText({
  text,
  live,
  animateInitial = false,
}: {
  text: string;
  live: boolean;
  animateInitial?: boolean;
}) {
  const [state, setState] = useState(() => ({
    text,
    live,
    words: words(text, live && animateInitial),
  }));
  let current = state;
  if (state.text !== text || state.live !== live) {
    const append = live && state.live && text.startsWith(state.text);
    current = {
      text,
      live,
      words: words(
        text,
        append,
        append ? state.words : undefined,
        append ? state.text.length : 0,
      ),
    };
    setState(current);
  }
  if (!live)
    return (
      <span className="t-stream" data-status="complete">
        {text}
      </span>
    );
  return (
    <span className="t-stream" data-status={live ? "running" : "complete"}>
      {current.words.map((word) =>
        /\S/u.test(word.text) ? (
          <span
            key={word.offset}
            className="t-stream-w"
            data-enter={live && word.enter}
            style={
              live && word.enter
                ? { animationDelay: `${word.delay}ms` }
                : undefined
            }
          >
            {word.text}
          </span>
        ) : (
          word.text
        ),
      )}
    </span>
  );
}
