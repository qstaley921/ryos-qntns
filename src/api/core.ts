import {
  type AbortableFetchDependencies,
  type AbortableFetchOptions,
} from "@/utils/abortableFetch";
import { getEffectiveTimezone } from "@/lib/timezoneConfig";

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  payload?: ApiErrorPayload;

  constructor(status: number, message: string, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = payload?.code;
    this.payload = payload;
  }
}

export interface ApiRequestOptions<TBody = unknown> {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: TBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeout?: number;
  retry?: AbortableFetchOptions["retry"];
}

export function getBrowserTimeZone(): string | null {
  if (typeof Intl === "undefined") {
    return null;
  }

  // Honor the International control panel preference (`auto` or a saved IANA id).
  try {
    const timeZone = getEffectiveTimezone();
    return timeZone && timeZone !== "Unknown" ? timeZone : null;
  } catch {
    return null;
  }
}

export function getBrowserTimeZoneHeaders(): Record<string, string> {
  const timeZone = getBrowserTimeZone();
  return timeZone ? { "X-User-Timezone": timeZone } : {};
}

async function parseErrorPayload(response: Response): Promise<ApiErrorPayload> {
  try {
    const data = (await response.json()) as ApiErrorPayload;
    return data ?? {};
  } catch {
    return {};
  }
}

// §6: ryOS's own server is gone. Every apiRequest fails the way an offline
// fetch does, so callers take their existing offline path.
async function performApiRequest<TBody = unknown>(
  _options: ApiRequestOptions<TBody>,
  _dependencies: AbortableFetchDependencies
): Promise<Response> {
  throw new TypeError("Failed to fetch");
}

const DEFAULT_API_REQUEST_DEPENDENCIES: AbortableFetchDependencies = {
  fetch: (input, init) => globalThis.fetch(input, init),
};

export async function apiRequestRaw<TBody = unknown>(
  options: ApiRequestOptions<TBody>,
  dependencies: AbortableFetchDependencies = DEFAULT_API_REQUEST_DEPENDENCIES
): Promise<Response> {
  return performApiRequest(options, dependencies);
}

export async function apiRequest<TResponse, TBody = unknown>(
  options: ApiRequestOptions<TBody>,
  dependencies: AbortableFetchDependencies = DEFAULT_API_REQUEST_DEPENDENCIES
): Promise<TResponse> {
  const response = await performApiRequest(options, dependencies);

  if (!response.ok) {
    const payload = await parseErrorPayload(response);
    const message =
      payload.error ||
      payload.message ||
      `Request failed with status ${response.status}`;
    throw new ApiRequestError(response.status, message, payload);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}
