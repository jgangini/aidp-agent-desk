import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Results } from "./Results";
import type { Finding } from "./types";

const motion = vi.hoisted(() => ({
  cards: [] as string[],
  durations: [] as number[],
  reverted: 0,
  starts: [] as (() => void)[],
  completions: [] as (() => void)[],
  transitions: [] as {
    target: HTMLElement | null;
    from?: Record<string, unknown>;
    to?: Record<string, unknown>;
  }[],
}));

vi.mock("gsap", () => ({
  gsap: {
    set: vi.fn(),
    context: (callback: () => void) => {
      callback();
      return {
        revert: () => {
          motion.reverted++;
        },
      };
    },
    timeline: (options?: { onStart?: () => void; onComplete?: () => void }) => {
      if (options?.onStart) motion.starts.push(options.onStart);
      if (options?.onComplete) motion.completions.push(options.onComplete);
      const timeline = {
        set: () => timeline,
        fromTo: (
          target: HTMLElement | null,
          from?: Record<string, unknown>,
          to?: Record<string, unknown>,
        ) => {
          motion.transitions.push({ target, from, to });
          if (target?.dataset.findingId && from?.height === 72)
            motion.cards.push(target.dataset.findingId);
          if (typeof to?.duration === "number")
            motion.durations.push(to.duration);
          return timeline;
        },
        to: () => timeline,
      };
      return timeline;
    },
  },
}));

beforeEach(() => {
  motion.cards = [];
  motion.durations = [];
  motion.reverted = 0;
  motion.starts = [];
  motion.completions = [];
  motion.transitions = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const findings: Finding[] = [
  {
    id: "web",
    requestId: "request",
    source: "web",
    title: "Evolución del mercado",
    text: "Demanda industrial creciente",
    at: 1,
  },
  {
    id: "social",
    requestId: "request",
    source: "facebook",
    title: "Comunidad local",
    text: "El café reúne a los vecinos",
    at: 2,
  },
  {
    id: "finance",
    requestId: "request",
    source: "yahoo_finance",
    title: "Finanzas públicas",
    text: "Última cotización disponible",
    at: 3,
  },
];

it.each([
  ["WEB", "web"],
  ["EVOLUCION", "web"],
  ["CAFÉ", "social"],
  ["cafe", "social"],
  ["  COTIZACION  ", "finance"],
  ["YAHOO", "finance"],
])(
  "filters locally by source, title and text ignoring case and accents: %s",
  (query, id) => {
    const { container } = render(<Results findings={findings} reducedMotion />);
    const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
    expect(input.getAttribute("placeholder")).toBe("Resultados (3)");
    fireEvent.change(input, { target: { value: query } });
    const cards = container.querySelectorAll("article[data-finding-id]");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-finding-id")).toBe(id);
    const description = document.getElementById(
      input.getAttribute("aria-describedby")!,
    );
    expect(description?.textContent).toBe("Mostrando 1 de 3 resultados");
  },
);

it("clears the search, restores every finding and returns focus to the input", () => {
  const { container } = render(<Results findings={findings} reducedMotion />);
  const input = screen.getByRole("textbox", {
    name: "Filtrar resultados",
  }) as HTMLInputElement;
  expect(screen.queryByRole("button", { name: "Exportar" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Resultados", level: 1 }).id).toBe(
    "results-title",
  );
  fireEvent.change(input, { target: { value: "imposible" } });
  expect(screen.getByRole("status").textContent).toBe("Sin coincidencias");
  expect(container.querySelector("article")).toBeNull();
  const clear = screen.getByRole("button", { name: "Limpiar filtro" });
  clear.focus();
  fireEvent.click(clear);
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
  expect(container.querySelectorAll("article")).toHaveLength(findings.length);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Limpiar filtro" })).toBeNull();
  expect(container.querySelector(".results-clear-echo")).toBeNull();
});

it("animates only new findings and never cards restored by filtering", () => {
  const { container, rerender } = render(
    <Results findings={findings} reducedMotion={false} />,
  );
  expect(motion.cards).toEqual(["web", "social", "finance"]);
  const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
  fireEvent.change(input, { target: { value: "web" } });
  fireEvent.change(input, { target: { value: "" } });
  expect(motion.cards).toEqual(["web", "social", "finance"]);
  const later: Finding = {
    id: "later",
    requestId: "request",
    source: "instagram",
    title: "Más señales",
    text: "Una observación nueva",
    at: 4,
  };
  rerender(<Results findings={[...findings, later]} reducedMotion={false} />);
  expect(motion.cards).toEqual(["web", "social", "finance", "later"]);
  fireEvent.change(input, { target: { value: "facebook" } });
  const hidden: Finding = { ...later, id: "hidden", source: "web" };
  rerender(
    <Results findings={[...findings, later, hidden]} reducedMotion={false} />,
  );
  fireEvent.change(input, { target: { value: "" } });
  expect(container.querySelectorAll("article")).toHaveLength(5);
  expect(motion.cards).toEqual(["web", "social", "finance", "later"]);
});

it("keeps the clear dissolve decorative, literal and interruptible by new typing", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (value: string) => ({ width: value.length * 7 }),
  } as unknown as CanvasRenderingContext2D);
  const { container, unmount } = render(
    <Results findings={findings} reducedMotion={false} />,
  );
  const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
  fireEvent.change(input, { target: { value: "<img src=x> café" } });
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
  const echo = container.querySelector(".results-clear-echo")!;
  expect(echo.textContent).toBe("<img src=x> café");
  expect(echo.getAttribute("aria-hidden")).toBe("true");
  expect(echo.querySelector("img")).toBeNull();
  expect(
    container.querySelector(".results-clear-glow")?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(
    container
      .querySelector(".results-clear-placeholder")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
  fireEvent.change(input, { target: { value: "nueva" } });
  expect(container.querySelector(".results-clear-echo")).toBeNull();
  expect(motion.reverted).toBeGreaterThan(0);
  unmount();
});

it("preserves analysis chart semantics without repeating publication cards", () => {
  const report: Finding = {
    id: "analysis",
    requestId: "request",
    source: "analysis",
    title: "Síntesis",
    text: "Resumen local",
    at: 1,
    references: [
      {
        evidence_id: "post",
        url: "https://example.org/post",
        title: "Publicación original",
      },
    ],
  };
  render(<Results findings={[report]} reducedMotion />);
  expect(
    screen.getByRole("table", {
      name: "Comparación ilustrativa de unidades procesadas",
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Publicación original/ }),
  ).toBeNull();
});

it("renders source counts as bars with accessible data and without repeated references", () => {
  const text = "Primera observación\n\nSegunda observación";
  const artifact = {
    artifact_id: "counts",
    kind: "bar",
    title: "Registros citados por fuente",
    rows: [
      { source: "x", value: 11 },
      { source: "youtube", value: 3 },
    ],
    evidence_ids: ["post"],
  };
  const { container, rerender } = render(
    <Results
      reducedMotion
      findings={[
        {
          id: "counts",
          requestId: "request",
          source: "analysis",
          title: artifact.title,
          text,
          at: 1,
          artifact,
          remote: true,
          references: [
            { evidence_id: "post", url: "https://example.org/post" },
          ],
        },
      ]}
    />,
  );
  expect(
    [...container.querySelectorAll(".finding-summary p")].map(
      (p) => p.textContent,
    ),
  ).toEqual(text.split("\n\n"));
  expect(container.querySelectorAll(".agent-bar-row")).toHaveLength(2);
  expect(
    container.querySelectorAll<HTMLElement>(".agent-bar-track > i")[0].style
      .width,
  ).toBe("100%");
  expect(screen.getByRole("table", { name: artifact.title }).className).toBe(
    "sr-only",
  );
  expect(container.querySelector(".source-posts")).toBeNull();
  rerender(
    <Results
      reducedMotion
      findings={[
        {
          id: "zero",
          requestId: "request",
          source: "analysis",
          title: "Ceros",
          text: "",
          at: 1,
          artifact: { ...artifact, rows: [{ source: "__proto__", value: 0 }] },
          remote: true,
        },
      ]}
    />,
  );
  expect(
    container.querySelector(".agent-bar-track > i")?.getAttribute("style"),
  ).toContain("width: 0%");
  expect(container.textContent).toContain("__proto__");
});

it("starts following new placeholders before content finishes revealing", () => {
  const scrollTo = vi.fn();
  const { container, rerender } = render(
    <Results findings={[]} reducedMotion={false} />,
  );
  // The list is created with the first finding.
  rerender(<Results findings={findings} reducedMotion={false} />);
  const rail = container.querySelector(".findings") as HTMLElement;
  rail.scrollTo = scrollTo;
  expect(motion.starts.length).toBe(3);
  motion.starts[0]();
  expect(scrollTo).toHaveBeenCalledWith({
    top: rail.scrollHeight,
    behavior: "smooth",
  });
});

it("toggles full source text independently of publication controls and keeps expansion by finding identity", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const report: Finding = {
    ...findings[0],
    text: "Un resumen largo. ".repeat(60),
    references: [
      {
        evidence_id: "post",
        url: "https://example.org/post",
        author_name: "Autora",
      },
    ],
  };
  const { container, rerender } = render(
    <Results findings={[report]} reducedMotion />,
  );
  const summary = screen.getByRole("button", {
    name: /^Un resumen largo/,
  });
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelector("article")?.getAttribute("data-expanded"),
  ).toBe("true");
  fireEvent.click(
    container.querySelector<HTMLAnchorElement>(".source-post-preview")!,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    container.querySelector(".source-post-preview")?.getAttribute("target"),
  ).toBe("_blank");
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Filtrar resultados" }),
    { target: { value: "inexistente" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Filtrar resultados" }),
    { target: { value: "" } },
  );
  expect(
    screen
      .getByRole("button", { name: /^Un resumen largo/ })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  rerender(
    <Results
      findings={[
        { ...report, text: report.text + "Texto nuevo." },
        findings[1],
      ]}
      reducedMotion
    />,
  );
  expect(
    screen.getByRole("button", { name: /^Un resumen largo/ }).textContent,
  ).toContain("Texto nuevo.");
  expect(
    screen
      .getByRole("button", { name: findings[1].text })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: /^Un resumen largo/ }));
  expect(
    container.querySelector("article")?.getAttribute("data-expanded"),
  ).toBe("false");
});

it("omits headings that only repeat the source but retains descriptive titles", () => {
  const { container } = render(
    <Results
      reducedMotion
      findings={[
        { ...findings[0], title: "WEB" },
        { ...findings[1], title: "facebook" },
        findings[2],
      ]}
    />,
  );
  expect(container.querySelector(".finding-web h2")).toBeNull();
  expect(container.querySelector(".finding-facebook h2")).toBeNull();
  expect(screen.getByRole("heading", { name: findings[2].title })).toBeTruthy();
});

it("highlights filtered words and mentions without interpreting HTML", () => {
  const { container } = render(
    <Results
      reducedMotion
      findings={[
        {
          ...findings[0],
          text: "@Bob comenta sobre café. mail@dominio.co <img src=x>",
        },
      ]}
    />,
  );
  expect(container.querySelector(".user-mention")?.textContent).toBe("@Bob");
  expect(container.querySelectorAll(".user-mention")).toHaveLength(1);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Filtrar resultados" }),
    { target: { value: "cafe" } },
  );
  expect(container.querySelector("mark.result-match")?.textContent).toBe(
    "café",
  );
  expect(container.querySelector("img")).toBeNull();
});

it("cancels the prior layout transition when filtering and expansion interrupt each other", () => {
  render(<Results reducedMotion={false} findings={findings} />);
  const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
  fireEvent.change(input, { target: { value: "mercado" } });
  const before = motion.reverted;
  fireEvent.click(
    screen.getByRole("button", { name: "Demanda industrial creciente" }),
  );
  expect(motion.reverted).toBeGreaterThan(before);
  const expanded = motion.reverted;
  fireEvent.change(input, { target: { value: "evolucion" } });
  expect(motion.reverted).toBeGreaterThan(expanded);
  expect(
    screen
      .getByRole("button", { name: "Demanda industrial creciente" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
});

it("measures expansion in rail coordinates and animates cards and summaries without moving the carousel", () => {
  const readBounds = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.matches(".finding, .finding-summary")) {
        const expanded =
          this.closest(".finding")?.getAttribute("data-expanded") === "true";
        const summary = this.matches(".finding-summary");
        return {
          ...readBounds.call(this),
          left: expanded ? 15 : 10,
          top: expanded ? 80 : 100,
          height: summary ? (expanded ? 100 : 20) : expanded ? 160 : 80,
        };
      }
      return readBounds.call(this);
    },
  );
  const report: Finding = {
    ...findings[0],
    references: [
      { evidence_id: "first", url: "https://example.org/first" },
      { evidence_id: "second", url: "https://example.org/second" },
    ],
  };
  const { container, unmount } = render(
    <Results findings={[report]} reducedMotion={false} />,
  );
  const rail = container.querySelector<HTMLElement>(".findings")!;
  rail.scrollTop = 40;
  const card = container.querySelector<HTMLElement>(".finding")!;
  const summary = container.querySelector<HTMLElement>(".finding-summary")!;
  const carousel = container.querySelector(".source-posts")!;
  expect(carousel).toBeTruthy();
  motion.transitions = [];
  summary.focus();
  fireEvent.keyDown(summary, { key: "Enter" });
  expect(document.activeElement).toBe(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  expect(card.dataset.resizing).toBe("true");
  expect(
    motion.transitions.find(({ target }) => target === card),
  ).toMatchObject({
    from: { x: -5, y: 20, height: 80 },
    to: { height: 160, duration: 0.3 },
  });
  expect(
    motion.transitions.find(({ target }) => target === summary),
  ).toMatchObject({
    from: { height: 20, overflow: "hidden" },
    to: { height: 100 },
  });
  expect(
    motion.transitions.every(
      ({ target }) => target === card || target === summary,
    ),
  ).toBe(true);
  expect(container.querySelector(".source-posts")).toBe(carousel);
  motion.completions.at(-1)!();
  expect(card.dataset.resizing).toBeUndefined();
  expect(card.style.gridRowEnd).toBe("span 172");
  const reverted = motion.reverted;
  unmount();
  expect(motion.reverted).toBeGreaterThan(reverted);
});

it.each(["300ms", ".3s"])(
  "reads resize tokens in both authored and minified CSS units: %s",
  (duration) => {
    const readStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = readStyle(element, pseudo);
        const read = style.getPropertyValue.bind(style);
        style.getPropertyValue = (name) =>
          name === "--resize-dur" ? duration : read(name);
        return style;
      },
    );
    render(<Results reducedMotion={false} findings={findings} />);
    motion.durations = [];
    fireEvent.change(
      screen.getByRole("textbox", { name: "Filtrar resultados" }),
      { target: { value: "mercado" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Demanda industrial creciente" }),
    );
    expect(motion.durations.length).toBeGreaterThan(0);
    expect(motion.durations.every((value) => value === 0.3)).toBe(true);
  },
);

it("temporarily expands matching summaries and restores manual state when search clears", () => {
  const long = {
    ...findings[0],
    text: "Introducción. ".repeat(100) + "Coincidencia escondida al final",
  };
  const { container } = render(
    <Results reducedMotion findings={[long, findings[1]]} />,
  );
  const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
  const summary = container.querySelector(".finding-summary")!;
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.change(input, { target: { value: "escondida" } });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("mark.result-match")?.textContent).toBe(
    "escondida",
  );
  fireEvent.change(input, { target: { value: "" } });
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(summary);
  fireEvent.change(input, { target: { value: "escondida" } });
  fireEvent.change(input, { target: { value: "" } });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
});
it("lets manual folding override the current search and reopens matches for a different query", () => {
  render(<Results reducedMotion findings={findings} />);
  const input = screen.getByRole("textbox", { name: "Filtrar resultados" });
  fireEvent.change(input, { target: { value: "industrial" } });
  const summary = screen.getByRole("button", { name: findings[0].text });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.change(input, { target: { value: "creciente" } });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  fireEvent.change(input, { target: { value: "industrial" } });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
  fireEvent.change(input, { target: { value: "industrial" } });
  expect(summary.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
  fireEvent.change(input, { target: { value: "web" } });
  expect(summary.getAttribute("aria-expanded")).toBe("false");
});
