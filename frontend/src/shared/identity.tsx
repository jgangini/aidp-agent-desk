import { createContext, useContext } from "react";

export const IdentityContext = createContext({
  hosted: false,
  admin: true,
  authenticated: false,
  leaving: false,
  logout: async () => {},
  openAccount: () => {},
});
export const useIdentity = () => useContext(IdentityContext);

let principal = "";
export function setStoragePrincipal(value: string) {
  principal = value;
}
export function storageKey(value: string) {
  return principal
    ? `agent-desk.user.${principal}.${value.replace(/^agent-desk\./, "")}`
    : value;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!principal) return globalThis.fetch(input, init);
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
  const protectedRequest =
    url.origin === window.location.origin &&
    (url.pathname.startsWith("/api/desk/") ||
      url.pathname.startsWith("/api/admin/") ||
      url.pathname === "/api/auth/logout");
  const owner = principal;
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (protectedRequest && owner) headers.set("X-Agent-Desk-User", owner);
  const response = await globalThis.fetch(input, { ...init, headers });
  if (
    protectedRequest &&
    owner &&
    (response.status === 401 || response.status === 409 || owner !== principal)
  ) {
    window.dispatchEvent(new Event("agent-desk-session-changed"));
    throw new Error(
      "La cuenta cambió o la sesión terminó. Vuelve a iniciar sesión.",
    );
  }
  return response;
}
