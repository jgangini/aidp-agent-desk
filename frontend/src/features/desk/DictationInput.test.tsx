import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { DictationInput } from "./DictationInput";

const state = vi.hoisted(() => ({
  composer: { text: "", dictation: undefined as object | undefined },
}));
vi.mock("@assistant-ui/react", () => ({
  useAuiState: (select: (value: typeof state) => unknown) => select(state),
  ComposerPrimitive: { Input: (props: object) => <textarea {...props} /> },
}));
afterEach(cleanup);

it("mirrors received partial revisions and restores the editable input after dictation", () => {
  state.composer = { text: "Borrador", dictation: undefined };
  const { container, rerender } = render(<DictationInput />);
  expect(container.querySelector(".dictation-input-mirror")).toBeNull();
  state.composer = { text: "Borrador hola", dictation: {} };
  rerender(<DictationInput />);
  const mirror = container.querySelector<HTMLElement>(
    ".dictation-input-mirror",
  )!;
  expect(mirror.textContent).toBe("Borrador hola");
  expect(mirror.getAttribute("aria-hidden")).toBe("true");
  state.composer.text = "Borrador hola mundo";
  rerender(<DictationInput />);
  expect(mirror.textContent).toBe("Borrador hola mundo");
  const input = container.querySelector("textarea")!;
  input.scrollTop = 24;
  fireEvent.scroll(input);
  expect(mirror.scrollTop).toBe(24);
  state.composer.dictation = undefined;
  rerender(<DictationInput />);
  expect(container.querySelector("textarea")).toBe(input);
  expect(container.querySelector(".dictation-input-mirror")).toBeNull();
});
