import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Tooltips } from "./Tooltips";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

it("waits 80ms on hover, suppresses native titles and restores them after leaving", () => {
  render(
    <div className="app">
      <button title="Copiar enlace">Copiar</button>
      <Tooltips />
    </div>,
  );
  const button = screen.getByRole("button");
  fireEvent.pointerOver(button);
  expect(button.hasAttribute("title")).toBe(false);
  advance(79);
  expect(screen.queryByRole("tooltip")).toBeNull();
  advance(1);
  expect(screen.getByRole("tooltip").textContent).toBe("Copiar enlace");
  fireEvent.pointerLeave(button);
  advance(80);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(button.getAttribute("title")).toBe("Copiar enlace");
  advance(50);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it.each([
  [
    { "data-tooltip": "Descripción", "aria-label": "Nombre", title: "Título" },
    "Descripción",
  ],
  [{ "aria-label": "Nombre", title: "Título" }, "Nombre"],
  [{ title: "Título" }, "Título"],
  [{}, "Texto visible"],
] as const)(
  "uses the explicit tooltip, accessible name, title and text fallback in order",
  (attributes, text) => {
    render(
      <div className="app">
        <button {...attributes}>Texto visible</button>
        <Tooltips />
      </div>,
    );
    fireEvent.focusIn(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").textContent).toBe(text);
  },
);

it("shows keyboard descriptions immediately and preserves the original accessible name and description", () => {
  render(
    <div className="app">
      <span id="help">Ayuda previa</span>
      <button
        aria-label="Configurar"
        aria-describedby="help"
        title="Título nativo"
      >
        Icono
      </button>
      <Tooltips />
    </div>,
  );
  const button = screen.getByRole("button", { name: "Configurar" });
  fireEvent.keyDown(document, { key: "Tab" });
  fireEvent.focusIn(button);
  const tooltip = screen.getByRole("tooltip");
  expect(button.getAttribute("aria-describedby")).toBe(`help ${tooltip.id}`);
  expect(button.getAttribute("aria-label")).toBe("Configurar");
  expect(tooltip.parentElement).toBe(document.body);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(button.getAttribute("aria-describedby")).toBe("help");
  expect(button.getAttribute("title")).toBe("Título nativo");
});

it("retargets the same bubble to a neighbour without another appear delay", () => {
  render(
    <div className="app">
      <button title="Primero">Uno</button>
      <button title="Segundo">Dos</button>
      <Tooltips />
    </div>,
  );
  const [first, second] = screen.getAllByRole("button");
  fireEvent.pointerOver(first);
  advance(80);
  const bubble = screen.getByRole("tooltip");
  fireEvent.pointerOut(first, { relatedTarget: second });
  fireEvent.pointerOver(second, { relatedTarget: first });
  expect(screen.getByRole("tooltip")).toBe(bubble);
  expect(bubble.textContent).toBe("Segundo");
  expect(first.getAttribute("title")).toBe("Primero");
  expect(first.hasAttribute("aria-describedby")).toBe(false);
  expect(second.getAttribute("aria-describedby")).toBe(bubble.id);
});

it("allows the pointer to cross into and remain over the tooltip", () => {
  render(
    <div className="app">
      <button>Herramienta</button>
      <Tooltips />
    </div>,
  );
  const button = screen.getByRole("button");
  fireEvent.pointerOver(button);
  advance(80);
  const bubble = screen.getByRole("tooltip");
  fireEvent.pointerOut(button);
  advance(40);
  fireEvent.pointerOver(bubble);
  advance(1000);
  expect(screen.getByRole("tooltip")).toBe(bubble);
  fireEvent.pointerLeave(bubble);
  advance(80);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it.each(["blur", "click", "scroll", "resize"])(
  "closes on %s and restores trigger attributes",
  (event) => {
    render(
      <div className="app">
        <button title="Ayuda">Acción</button>
        <Tooltips />
      </div>,
    );
    const button = screen.getByRole("button");
    fireEvent.focusIn(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    if (event === "blur") fireEvent.focusOut(button);
    else if (event === "click") fireEvent.click(button);
    else if (event === "scroll") fireEvent.scroll(document);
    else fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("title")).toBe("Ayuda");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  },
);

it("ignores disabled, hidden, touch and out-of-scope controls", () => {
  render(
    <>
      <button title="Fuera">Fuera</button>
      <div className="app">
        <button disabled>Deshabilitado</button>
        <div role="option" aria-disabled="true">
          Opción
        </div>
        <div hidden>
          <button>Oculto</button>
        </div>
        <button>Toque</button>
        <Tooltips />
      </div>
    </>,
  );
  for (const button of screen.getAllByRole("button", { hidden: true })) {
    const pointer = new Event("pointerover", { bubbles: true });
    Object.defineProperty(pointer, "pointerType", {
      value: button.textContent === "Toque" ? "touch" : "mouse",
    });
    fireEvent(button, pointer);
    if (button.textContent !== "Toque") fireEvent.focusIn(button);
    advance(100);
    expect(screen.queryByRole("tooltip")).toBeNull();
  }
  fireEvent.focusIn(screen.getByRole("option"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it.each(["hidden", "removed"])(
  "dismisses a tooltip whose trigger is %s",
  async (change) => {
    render(
      <div className="app">
        <button title="Ayuda">Acción</button>
        <Tooltips />
      </div>,
    );
    const button = screen.getByRole("button");
    fireEvent.focusIn(button);
    await act(async () => {
      if (change === "hidden") button.hidden = true;
      else button.remove();
      await Promise.resolve();
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("title")).toBe("Ayuda");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  },
);

it("clamps the bubble to the viewport and places it below a trigger near the top", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("site-tooltip-text")
        ? new DOMRect(0, 0, 120, 16)
        : new DOMRect(-20, 4, 40, 20);
    },
  );
  render(
    <div className="app">
      <button>Ayuda</button>
      <Tooltips />
    </div>,
  );
  fireEvent.focusIn(screen.getByRole("button"));
  const tip = screen.getByRole("tooltip");
  expect(tip.style.position).toBe("fixed");
  expect(tip.style.left).toBe("8px");
  expect(tip.style.top).toBe("32px");
  expect(tip.style.width).toBe("144px");
  expect(tip.getAttribute("data-side")).toBe("bottom");
});

it("cleans pending timers, listeners, native titles and descriptions on unmount", () => {
  const { unmount } = render(
    <div className="app">
      <button title="Nativo" aria-describedby="original">
        Ayuda
      </button>
      <Tooltips />
    </div>,
  );
  const button = screen.getByRole("button");
  fireEvent.pointerOver(button);
  expect(button.hasAttribute("title")).toBe(false);
  unmount();
  advance(1000);
  expect(button.getAttribute("title")).toBe("Nativo");
  expect(button.getAttribute("aria-describedby")).toBe("original");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("clears the bubble and restores attributes when the delegated scope changes", () => {
  const page = (scope: string) => (
    <>
      <div className="app">
        <button title="Primero">Uno</button>
      </div>
      <div className="other">
        <button title="Segundo">Dos</button>
      </div>
      <Tooltips rootSelector={scope} />
    </>
  );
  const { rerender } = render(page(".app"));
  const first = screen.getByRole("button", { name: "Uno" });
  fireEvent.focusIn(first);
  expect(screen.getByRole("tooltip").textContent).toBe("Primero");
  rerender(page(".other"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(first.getAttribute("title")).toBe("Primero");
  expect(first.hasAttribute("aria-describedby")).toBe(false);
  fireEvent.focusIn(screen.getByRole("button", { name: "Dos" }));
  expect(screen.getByRole("tooltip").textContent).toBe("Segundo");
});

it("snaps the first opening into place and only travels between visible controls", () => {
  render(
    <div className="app">
      <button>Uno</button>
      <button>Dos</button>
      <Tooltips />
    </div>,
  );
  const [first, second] = screen.getAllByRole("button");
  fireEvent.pointerOver(first);
  advance(80);
  expect(screen.getByRole("tooltip").dataset.travel).toBe("false");
  fireEvent.pointerOver(second);
  expect(screen.getByRole("tooltip").dataset.travel).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.pointerOver(first);
  advance(80);
  expect(screen.getByRole("tooltip").dataset.travel).toBe("false");
});

it("does not show tooltips in explicitly excluded suggestion groups", () => {
  render(
    <div className="app">
      <div data-tooltip-disabled="true">
        <button>Sugerencia</button>
      </div>
      <Tooltips />
    </div>,
  );
  const button = screen.getByRole("button");
  fireEvent.pointerOver(button);
  advance(100);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focusIn(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
