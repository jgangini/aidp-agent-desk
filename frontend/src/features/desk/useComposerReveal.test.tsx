import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useComposerReveal, useComposerTransition } from "./useComposerReveal";

const animation = vi.hoisted(() => ({ fromTo: vi.fn(), revert: vi.fn() }));
const fonts = Object.getOwnPropertyDescriptor(document, "fonts");
vi.mock("gsap", () => ({
  gsap: {
    context: (callback: () => void) => {
      callback();
      return { revert: animation.revert };
    },
    fromTo: animation.fromTo,
  },
}));

afterEach(() => {
  cleanup();
  if (fonts) Object.defineProperty(document, "fonts", fonts);
  else Reflect.deleteProperty(document, "fonts");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function Welcome({ target }: { target: string }) {
  const root = useRef<HTMLDivElement>(null);
  useComposerReveal(root, true, target);
  return (
    <div ref={root}>
      <div key={target} className="aui-welcome-build" data-empty="true">
        <h3>Welcome</h3>
        <div className="aui-composer-shell" />
      </div>
    </div>
  );
}

it("marks a replacement welcome ready when switching agents after the one-time reveal was interrupted", () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: new Promise(() => {}) },
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const { container, rerender } = render(<Welcome target="demo" />);
  const initial = container.querySelector(".aui-welcome-build")!;
  fireEvent.pointerDown(window);
  expect(initial.getAttribute("data-build")).toBe("ready");
  rerender(<Welcome target="test:profile" />);
  const replacement = container.querySelector(".aui-welcome-build")!;
  expect(replacement).not.toBe(initial);
  expect(replacement.getAttribute("data-build")).toBe("ready");
  expect(replacement.getAttribute("data-reveal")).toBe("instant");
  expect(screen.getByRole("heading").textContent).toBe("Welcome");
  rerender(<Welcome target="profile" />);
  expect(
    container.querySelector(".aui-welcome-build")?.getAttribute("data-build"),
  ).toBe("ready");
});

function Composer({
  nodeKey,
  count,
  reduced = false,
}: {
  nodeKey: string;
  count: number;
  reduced?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const capture = useComposerTransition(root, count, reduced);
  return (
    <div ref={root}>
      <div key={nodeKey} className="aui-composer-root" />
      <button onClick={capture}>Capture</button>
    </div>
  );
}

it("does not apply a captured composer transition to a replacement runtime node", () => {
  const { rerender } = render(<Composer nodeKey="demo" count={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  rerender(<Composer nodeKey="test" count={1} />);
  expect(animation.fromTo).not.toHaveBeenCalled();
});

it("retains the submit transition for the same composer and respects reduced motion", () => {
  const { rerender } = render(<Composer nodeKey="same" count={0} />);
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  rerender(<Composer nodeKey="same" count={1} />);
  expect(animation.fromTo).toHaveBeenCalledOnce();
  act(() => animation.fromTo.mockClear());
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  rerender(<Composer nodeKey="same" count={2} reduced />);
  expect(animation.fromTo).not.toHaveBeenCalled();
});
