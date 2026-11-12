import createClient from "openapi-fetch";
import type { paths } from "./api.generated";

export function client(token: string) {
  return createClient<paths>({ baseUrl: window.location.origin, headers: { Authorization: `Bearer ${token}` } });
}
