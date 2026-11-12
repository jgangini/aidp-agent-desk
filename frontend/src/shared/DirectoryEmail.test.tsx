import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DirectoryEmail } from "./DirectoryEmail";
import { IdentityContext } from "./identity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function Widget({
  hosted = true,
  authenticated = true,
  admin = true,
  disabled = false,
  onSubmit = vi.fn(),
  onKeyDown = vi.fn(),
} = {}) {
  const [value, setValue] = useState("");
  return (
    <IdentityContext.Provider
      value={{
        hosted,
        authenticated,
        admin,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onKeyDown={onKeyDown}
      >
        <DirectoryEmail value={value} onChange={setValue} disabled={disabled} />
      </form>
    </IdentityContext.Provider>
  );
}
async function search(value: string) {
  const input = screen.getByRole("combobox", { name: "Correo electrónico" });
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  return input as HTMLInputElement;
}

it("debounces two-character read-only searches and selects emails using the keyboard", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify([
          { email: "jo@example.com" },
          { email: "john@example.com" },
        ]),
      ),
    );
  const onSubmit = vi.fn();
  vi.stubGlobal("fetch", request);
  render(<Widget onSubmit={onSubmit} />);
  const input = screen.getByRole("combobox", {
    name: "Correo electrónico",
  }) as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "j" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(request).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "jo" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(249);
  });
  expect(request).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(request.mock.calls[0][0]).toBe("/api/admin/directory-users?q=jo");
  expect(request.mock.calls[0][1].method).toBeUndefined();
  const list = screen.getByRole("listbox", {
    name: "Correos del dominio Oracle",
  });
  expect(input.getAttribute("aria-controls")).toBe(list.id);
  expect(input.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "jo@example.com" }).id,
  );
  fireEvent.keyDown(input, { key: "End" });
  expect(
    screen
      .getByRole("option", { name: "john@example.com" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("john@example.com");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
});

it("aborts old lookups and ignores stale results even when the transport still resolves", async () => {
  const pending: {
    signal: AbortSignal;
    resolve: (response: Response) => void;
  }[] = [];
  const request = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) =>
        pending.push({ signal: init.signal as AbortSignal, resolve }),
      ),
  );
  vi.stubGlobal("fetch", request);
  render(<Widget />);
  const input = await search("old");
  expect(pending).toHaveLength(1);
  fireEvent.change(input, { target: { value: "new" } });
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  await act(async () => {
    pending[1].resolve(
      new Response(JSON.stringify([{ email: "new@example.com" }])),
    );
  });
  expect(screen.getByRole("option", { name: "new@example.com" })).toBeTruthy();
  await act(async () => {
    pending[0].resolve(
      new Response(JSON.stringify([{ email: "old@example.com" }])),
    );
  });
  expect(screen.queryByRole("option", { name: "old@example.com" })).toBeNull();
  expect(screen.getByRole("option", { name: "new@example.com" })).toBeTruthy();
});

it("encodes queries, deduplicates suggestions and supports pointer selection", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify([
          { email: "jane+desk@example.com" },
          { email: "jane+desk@example.com" },
        ]),
      ),
    );
  vi.stubGlobal("fetch", request);
  render(<Widget />);
  const input = await search("jane+");
  expect(request.mock.calls[0][0]).toBe("/api/admin/directory-users?q=jane%2B");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.pointerDown(screen.getByRole("option"));
  fireEvent.click(screen.getByRole("option"));
  expect(input.value).toBe("jane+desk@example.com");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("reports lookup failures, retries on refocus and never equates missing suggestions with a missing account", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response("[]"));
  vi.stubGlobal("fetch", request);
  render(<Widget />);
  const input = await search("member");
  expect(screen.getByRole("alert").textContent).toContain(
    "No se pudieron consultar los correos",
  );
  fireEvent.blur(input);
  fireEvent.focus(input);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(
    "No hay sugerencias para esta búsqueda.",
  );
  expect(input.value).toBe("member");
  expect(request).toHaveBeenCalledTimes(2);
});

it("lets Escape dismiss suggestions before allowing modal Escape to propagate", async () => {
  const onKeyDown = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ email: "member@example.com" }])),
      ),
  );
  render(<Widget onKeyDown={onKeyDown} />);
  const input = await search("member");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onKeyDown).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onKeyDown).toHaveBeenCalledOnce();
});

it("aborts lookup when the add modal unmounts", async () => {
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    }),
  );
  const view = render(<Widget />);
  await search("member");
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it.each([
  [true, true, false, false],
  [false, true, true, false],
  [true, false, true, false],
  [true, true, true, true],
])(
  "does not query outside an enabled authenticated admin input (%s %s %s %s)",
  async (hosted, authenticated, admin, disabled) => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    render(
      <Widget
        hosted={hosted}
        authenticated={authenticated}
        admin={admin}
        disabled={disabled}
      />,
    );
    const input = await search("member");
    expect(input.disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
  },
);
