import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarkdownText } from "./MarkdownText";
import { ToolProgress } from "./ToolProgress";
import { ChatActionsContext } from "./chatContext";
import { emptyRemoteSnapshot } from "./remoteAgent";

vi.mock("@assistant-ui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react")>()),
  useAuiState: () => "process-assistant",
}));

afterEach(cleanup);

it("renders rich Markdown while running and retains its structure on completion", () => {
  const text =
    "## Hallazgos\n\n**Precios** y *opiniones*.\n\n- Uno\n- Dos\n\n> Una atribución\n\n| Fuente | Total |\n| --- | --- |\n| X | 2 |\n\n`código`\n\n```js\nconst n = 2;\n```\n\n[Fuente](https://example.org/post)";
  const { container, rerender } = render(
    <MarkdownText text={text} live animateInitial />,
  );
  expect(screen.getByRole("heading", { name: "Hallazgos" })).toBeTruthy();
  expect(container.querySelector("strong")?.textContent).toBe("Precios");
  expect(container.querySelector("em")?.textContent).toBe("opiniones");
  expect(container.querySelectorAll("li")).toHaveLength(2);
  expect(container.querySelector("blockquote")?.textContent).toContain(
    "atribución",
  );
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelector("pre code")?.textContent).toContain(
    "const n = 2;",
  );
  expect(screen.getByRole("link", { name: "Fuente" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
  expect(container.querySelector('[data-enter="true"]')).toBeTruthy();
  expect(container.textContent).not.toContain("**Precios**");
  rerender(<MarkdownText text={text + "\n\nFinal."} live={false} />);
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  expect(container.querySelector("strong")?.textContent).toBe("Precios");
  expect(container.textContent).toContain("Final.");
});

it("handles incomplete streamed formatting and does not replay restored text", () => {
  const { container, rerender } = render(
    <MarkdownText text="Un **avance" live />,
  );
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  rerender(<MarkdownText text="Un **avance completo**" live />);
  expect(container.querySelector("strong")?.textContent).toBe(
    "avance completo",
  );
  expect(container.querySelector("script,img")).toBeNull();
});

it("does not execute raw HTML or render unsafe links and remote Markdown images", () => {
  const text =
    '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[malicioso](javascript:alert%281%29) [local](/api/desk/profiles) [credencial](https://user:pass@example.org) ![rastreo](https://example.org/track.png)';
  const { container } = render(<MarkdownText text={text} live={false} />);
  expect(container.querySelector("script,img,iframe,a,[onerror]")).toBeNull();
  expect(container.textContent).toContain("malicioso");
});

it("highlights mention labels in streamed Markdown without touching code, email or destinations", () => {
  const text =
    "**@José.uno** y @otra. usuario@ejemplo.com\n\n`@código`\n\n```text\n@bloque\n```\n\n[@enlace](https://example.org/@destino)";
  const { container, rerender } = render(
    <MarkdownText text={text} live animateInitial />,
  );
  expect(
    [...container.querySelectorAll(".user-mention")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["@José.uno", "@otra", "@enlace"]);
  expect(
    container.querySelector("code .user-mention,pre .user-mention"),
  ).toBeNull();
  expect(
    container.querySelector("a[href='https://example.org/@destino']")
      ?.textContent,
  ).toBe("@enlace");
  expect(
    container.querySelector(".user-mention .t-stream-w[data-enter=true]"),
  ).toBeTruthy();
  expect(container.textContent).toContain("usuario@ejemplo.com");
  rerender(<MarkdownText text={text + "\n\n@final"} live={false} />);
  expect(
    [...container.querySelectorAll(".user-mention")].map(
      (node) => node.textContent,
    ),
  ).toContain("@final");
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  expect(container.querySelector("script,img")).toBeNull();
});

it("highlights parsed text and mentions with accent-insensitive search in compact mode", () => {
  const text =
    "## José\n\n**JOSÉ** y @José.uno; José.\n\n[Fuente de José](https://example.org/Jose)";
  const { container, rerender } = render(
    <MarkdownText text={text} live animateInitial compact query="jose" />,
  );
  expect(container.querySelector(".markdown-text-compact")).toBeTruthy();
  expect(
    [...container.querySelectorAll("mark")].map((node) => node.textContent),
  ).toEqual(["José", "JOSÉ", "José", "José", "José"]);
  expect(container.querySelector(".user-mention")?.textContent).toBe(
    "@José.uno",
  );
  expect(container.querySelector(".user-mention mark")?.textContent).toBe(
    "José",
  );
  expect(
    container.querySelector("mark .t-stream-w[data-enter=true]"),
  ).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://example.org/Jose",
  );
  rerender(<MarkdownText text="hola @Ána" live={false} query="hola @ana" />);
  expect(
    [...container.querySelectorAll("mark")]
      .map((node) => node.textContent)
      .join(""),
  ).toBe("hola @Ána");
  expect(container.querySelector(".user-mention")?.textContent).toBe("@Ána");
  expect(container.querySelector("[data-enter=true]")).toBeNull();
  rerender(<MarkdownText text={text} live={false} query=" " />);
  expect(container.querySelector("mark")).toBeNull();
  expect(container.querySelector(".markdown-text-compact")).toBeNull();
});

it("retains rich link labels without nested actions when links are disabled", () => {
  const text =
    "[**@José**](https://example.org/post) y [ataque](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n![remota](https://example.org/track.png)";
  const { container } = render(
    <MarkdownText
      text={text}
      live={false}
      compact
      links={false}
      query="jose"
    />,
  );
  expect(container.querySelector("a,img,script,[onerror]")).toBeNull();
  expect(
    container.querySelector("strong .user-mention mark")?.textContent,
  ).toBe("José");
  expect(container.textContent).toContain("ataque");
});

it("renders streamed and completed process output with semantic nested Markdown lists", () => {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = [
    {
      id: "process",
      question: "Q",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  const text =
    "### Fuentes\n\n1. **Primer dato** @Ána\n   - Dato anidado\n2. [Fuente](https://example.org/post)\n\n<script>alert(1)</script>";
  snapshot.events = [
    {
      id: 1,
      at: 1,
      type: "source.streaming",
      text,
      source: "web",
      from: "agent",
      to: "desk",
      requestId: "process",
    },
  ];
  const renderProcess = () => (
    <ChatActionsContext.Provider
      value={{ snapshot, onFeedback: () => {}, onRegenerate: () => {} }}
    >
      <ToolProgress />
    </ChatActionsContext.Provider>
  );
  const { container, rerender } = render(renderProcess());
  const markdown = container.querySelector(
    ".tool-progress .markdown-text-compact",
  )!;
  expect(markdown.querySelector("h3")?.textContent).toBe("Fuentes");
  expect(markdown.querySelector("ol > li > ul > li")?.textContent).toBe(
    "Dato anidado",
  );
  expect(markdown.querySelector("strong")?.textContent).toBe("Primer dato");
  expect(markdown.querySelector(".user-mention")?.textContent).toBe("@Ána");
  expect(markdown.querySelector("script,p > div")).toBeNull();
  expect(markdown.closest("p")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Fuente" }).getAttribute("href"),
  ).toBe("https://example.org/post");
  snapshot.conversations[0].status = "completed";
  snapshot.findings = [
    {
      id: "finding",
      requestId: "process",
      source: "web",
      title: "Fuente",
      text,
      at: 1,
    },
  ];
  rerender(renderProcess());
  expect(
    container.querySelectorAll(".tool-progress .markdown-text"),
  ).toHaveLength(1);
  expect(
    container.querySelector(".markdown-text ol > li > ul > li")?.textContent,
  ).toBe("Dato anidado");
  expect(container.querySelector("[data-enter=true]")).toBeNull();
});
