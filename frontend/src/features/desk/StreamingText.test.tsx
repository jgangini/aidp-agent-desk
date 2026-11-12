import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StreamingText } from "./StreamingText";

afterEach(cleanup);

it("animates appended words once while preserving partial words and existing nodes", () => {
  const { container, rerender } = render(<StreamingText text="" live />);
  rerender(<StreamingText text="Prim" live />);
  const first = container.querySelector(".t-stream-w")!;
  expect(first.textContent).toBe("Prim");
  expect(first.getAttribute("data-enter")).toBe("true");
  rerender(<StreamingText text="Primera fuente" live />);
  const updated = container.querySelectorAll(".t-stream-w");
  expect(updated[0]).toBe(first);
  expect(updated[0].textContent).toBe("Primera");
  expect(updated[1].getAttribute("data-enter")).toBe("true");
  const second = updated[1];
  const animation = first.getAttribute("style");
  rerender(<StreamingText text="Primera fuente recibida" live />);
  const appended = container.querySelectorAll(".t-stream-w");
  expect(appended[0]).toBe(first);
  expect(appended[1]).toBe(second);
  expect(first.getAttribute("style")).toBe(animation);
  expect(container.textContent).toBe("Primera fuente recibida");
});

it("caps a received batch delay instead of queueing a second streaming clock", () => {
  const text = "uno dos tres cuatro cinco seis siete ocho nueve diez";
  const { container, rerender } = render(<StreamingText text="" live />);
  rerender(<StreamingText text={text} live />);
  const delays = [
    ...container.querySelectorAll<HTMLElement>(".t-stream-w"),
  ].map((word) => word.style.animationDelay);
  expect(delays).toEqual([
    "0ms",
    "60ms",
    "120ms",
    "180ms",
    "240ms",
    "240ms",
    "240ms",
    "240ms",
    "240ms",
    "240ms",
  ]);
  expect(container.textContent).toBe(text);
});

it("renders history, replacement and a restored live session immediately", () => {
  const { container, rerender, unmount } = render(
    <StreamingText text="Respuesta guardada" live={false} />,
  );
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  rerender(<StreamingText text="Respuesta guardada" live />);
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  rerender(<StreamingText text="Corrección de respuesta" live />);
  expect(container.textContent).toBe("Corrección de respuesta");
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  unmount();
  const restored = render(<StreamingText text="Otra sesión activa" live />);
  expect(restored.container.textContent).toBe("Otra sesión activa");
  expect(restored.container.querySelector('[data-enter="true"]')).toBeNull();
});

it("finishes all words immediately on terminal status and never reanimates them", () => {
  const { container, rerender } = render(
    <StreamingText text="Salida nueva" live animateInitial />,
  );
  expect(container.querySelectorAll('[data-enter="true"]')).toHaveLength(2);
  rerender(
    <StreamingText text="Salida nueva completa" live={false} animateInitial />,
  );
  expect(container.textContent).toBe("Salida nueva completa");
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
  expect(container.querySelector("[style]")).toBeNull();
  rerender(<StreamingText text="Salida nueva completa" live animateInitial />);
  expect(container.querySelector('[data-enter="true"]')).toBeNull();
});

it("preserves whitespace and a single accessible copy without HTML interpretation", () => {
  const text = "  Una\tpalabra\n\ncon  espacios & <img src=x>\n ";
  const { container, rerender } = render(<StreamingText text="" live />);
  rerender(<StreamingText text={text} live />);
  expect(container.textContent).toBe(text);
  expect(
    container.querySelector("img,script,[aria-hidden],[aria-label]"),
  ).toBeNull();
  expect(container.querySelectorAll(".t-stream")).toHaveLength(1);
  rerender(<StreamingText text={`${text}\tFinal`} live />);
  expect(container.textContent).toBe(`${text}\tFinal`);
  rerender(<StreamingText text={`${text}\tFinal`} live={false} />);
  expect(container.textContent).toBe(`${text}\tFinal`);
});
