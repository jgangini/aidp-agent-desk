import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CSSProperties } from "react";
import { ChatResizeHandle, useChatResize } from "./ChatResize";

let resize: () => void;

function Harness({
  width = 1440,
  share = 0.4,
  floor = 400,
  enabled = true,
}: {
  width?: number;
  share?: number;
  floor?: number;
  enabled?: boolean;
}) {
  const control = useChatResize();
  return (
    <main
      ref={control.layoutRef}
      data-width={width}
      style={
        {
          ...control.style,
          "--chat-width-share": share,
          "--chat-width-floor": `${floor}px`,
          "--chat-resize-allowed": enabled ? "1" : "0",
        } as CSSProperties
      }
    >
      <ChatResizeHandle resize={control} />
    </main>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return { width: Number(this.dataset.width ?? 0) } as DOMRect;
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("bounds keyboard adjustments to 100px below the original responsive width", () => {
  render(<Harness />);
  const handle = screen.getByRole("separator", {
    name: "Ajustar ancho del chat",
  });
  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-valuemax")).toBe("576");
  expect(handle.getAttribute("aria-valuemin")).toBe("476");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("566");
  fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
  expect(handle.getAttribute("aria-valuenow")).toBe("576");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle.getAttribute("aria-valuenow")).toBe("476");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("476");
  fireEvent.keyDown(handle, { key: "End" });
  expect(handle.getAttribute("aria-valuenow")).toBe("576");
});

it("captures a drag and stops changing width after capture is lost", () => {
  render(<Harness />);
  const handle = screen.getByRole("separator") as HTMLDivElement;
  const captured = new Set<number>();
  handle.setPointerCapture = vi.fn((pointer) => captured.add(pointer));
  handle.hasPointerCapture = vi.fn((pointer) => captured.has(pointer));
  handle.releasePointerCapture = vi.fn((pointer) => captured.delete(pointer));
  fireEvent.pointerDown(handle, { clientX: 864, pointerId: 7, button: 0 });
  expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
  expect(document.activeElement).toBe(handle);
  fireEvent.pointerMove(handle, { clientX: 904, pointerId: 8 });
  expect(handle.getAttribute("aria-valuenow")).toBe("576");
  fireEvent.pointerMove(handle, { clientX: 904, pointerId: 7 });
  expect(handle.getAttribute("aria-valuenow")).toBe("536");
  fireEvent.pointerMove(handle, { clientX: 1100, pointerId: 7 });
  expect(handle.getAttribute("aria-valuenow")).toBe("476");
  fireEvent.lostPointerCapture(handle, { pointerId: 7 });
  expect(handle.hasAttribute("data-dragging")).toBe(false);
  fireEvent.pointerMove(handle, { clientX: 700, pointerId: 7 });
  expect(handle.getAttribute("aria-valuenow")).toBe("476");
});

it("respects the 400px floor on narrower desktops and the mobile breakpoint", () => {
  const { rerender } = render(<Harness />);
  fireEvent.keyDown(screen.getByRole("separator"), { key: "Home" });
  rerender(<Harness width={1000} share={0.45} floor={360} />);
  act(() => resize());
  const handle = screen.getByRole("separator");
  expect(handle.getAttribute("aria-valuemax")).toBe("450");
  expect(handle.getAttribute("aria-valuemin")).toBe("400");
  expect(handle.getAttribute("aria-valuenow")).toBe("400");
  rerender(<Harness width={700} share={0.45} floor={360} enabled={false} />);
  act(() => resize());
  expect(screen.queryByRole("separator")).toBeNull();
  expect(handle.tabIndex).toBe(-1);
  rerender(<Harness width={1440} />);
  act(() => resize());
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
    "576",
  );
});

it("cancels pointer capture when resizing becomes unavailable", () => {
  const { rerender } = render(<Harness />);
  const handle = screen.getByRole("separator") as HTMLDivElement;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { clientX: 864, pointerId: 3, button: 0 });
  rerender(<Harness width={700} share={0.45} floor={360} enabled={false} />);
  act(() => resize());
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(3);
  expect(handle.hasAttribute("data-dragging")).toBe(false);
  fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 3 });
  expect(handle.getAttribute("aria-valuenow")).toBe("360");
});

it("restores the chosen size after remounting, as on a page refresh", () => {
  const { unmount } = render(<Harness />);
  fireEvent.keyDown(screen.getByRole("separator"), {
    key: "ArrowRight",
    shiftKey: true,
  });
  expect(localStorage.getItem("agent-desk.chat-narrow-by")).toBe("25");
  unmount();
  render(<Harness />);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
    "551",
  );
});

it("ignores invalid stored values and works when writes are blocked", () => {
  localStorage.setItem("agent-desk.chat-narrow-by", "NaN");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<Harness />);
  const handle = screen.getByRole("separator");
  expect(handle.getAttribute("aria-valuenow")).toBe("576");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("566");
});
