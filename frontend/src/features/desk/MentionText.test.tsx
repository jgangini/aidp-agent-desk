import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MentionText, mentionTokens } from "./MentionText";

afterEach(cleanup);

it("identifies Unicode handles and internal dots without changing punctuation or email addresses", () => {
  const text =
    "Hola @usuario.uno, (@José_2). usuario@ejemplo.com foo.@nadie @otra...";
  const tokens = mentionTokens(text);
  expect(
    tokens.filter((token) => token.mention).map((token) => token.text),
  ).toEqual(["@usuario.uno", "@José_2", "@otra"]);
  expect(tokens.map((token) => token.text).join("")).toBe(text);
  expect(
    tokens.every((token) => text.slice(token.start, token.end) === token.text),
  ).toBe(true);
});

it("keeps mentions gray-span hooks while highlighting repeated accent-insensitive matches", () => {
  const text = "José, JOSÉ y @José.uno; José.";
  const { container } = render(<MentionText text={text} query="jose" />);
  expect(container.textContent).toBe(text);
  expect(
    [...container.querySelectorAll("mark")].map((node) => node.textContent),
  ).toEqual(["José", "JOSÉ", "José", "José"]);
  expect(container.querySelector(".user-mention")?.textContent).toBe(
    "@José.uno",
  );
  expect(
    container.querySelector(".user-mention > mark.result-match")?.textContent,
  ).toBe("José");
});

it("highlights across mention boundaries and safely renders arbitrary text and emoji", () => {
  const text = "🙂 hola @Ána <img src=x>";
  const { container, rerender } = render(
    <MentionText text={text} query="hola @ana" />,
  );
  expect(container.textContent).toBe(text);
  expect(
    [...container.querySelectorAll("mark")]
      .map((node) => node.textContent)
      .join(""),
  ).toBe("hola @Ána");
  expect(container.querySelector("img")).toBeNull();
  rerender(<MentionText text={text} query="🙂" />);
  expect(container.querySelector("mark")?.textContent).toBe("🙂");
  rerender(<MentionText text={text} query="  " />);
  expect(container.querySelector("mark")).toBeNull();
});
