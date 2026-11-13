import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IdentityContext } from "../../shared/identity";
import { ReportEnableAction, ReportSettings } from "./ReportSettings";
import type { AgentProfile } from "./profiles";

const profile: AgentProfile = {
  id: "a".repeat(32),
  name: "Mercado",
  ready: true,
  endpoint_host: "host",
  flow_id: "flow",
  region: "us-chicago-1",
  profile: "DEFAULT",
  instance_id: "instance",
  workspace_id: "workspace",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("does not expose report configuration or read settings for a hosted member", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <IdentityContext.Provider
      value={{
        hosted: true,
        admin: false,
        authenticated: true,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <ReportSettings profiles={[profile]} />
    </IdentityContext.Provider>,
  );
  expect(
    screen.queryByRole("region", { name: "Entrega de informes" }),
  ).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it("persists an explicit PROD revocation without changing TEST enrollment", async () => {
  const fetcher = vi.fn(
    async (_url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === "PUT"
            ? JSON.parse(String(options.body))
            : { prod: true, test: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<ReportSettings profiles={[profile]} />);
  const production = screen.getByRole("checkbox", {
    name: "Informes PROD de Mercado",
  });
  await waitFor(() =>
    expect((production as HTMLInputElement).checked).toBe(true),
  );
  fireEvent.click(production);
  await waitFor(() =>
    expect((production as HTMLInputElement).checked).toBe(false),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Informes TEST de Mercado",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe(
    `/api/desk/profiles/${profile.id}/reports`,
  );
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    prod: false,
    test: true,
  });
});

it.each([false, true])(
  "enables only the chosen surface (TEST=%s) and waits for explicit confirmation",
  async (testing) => {
    const fetcher = vi.fn(
      async (_url: string, options?: RequestInit) =>
        new Response(
          JSON.stringify(
            options?.method === "PUT"
              ? JSON.parse(String(options.body))
              : { prod: false, test: false },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const enabled = vi.fn(async () => {});
    render(
      <ReportEnableAction
        agentId={`${testing ? "test:" : ""}${profile.id}`}
        onEnabled={enabled}
      />,
    );
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Habilitar informes" }));
    await waitFor(() => expect(enabled).toHaveBeenCalledOnce());
    expect(
      fetcher.mock.calls.every(
        ([url]) => url === `/api/desk/profiles/${profile.id}/reports`,
      ),
    ).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      prod: !testing,
      test: testing,
    });
  },
);
