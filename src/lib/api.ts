/**
 * Shared helper for building API URLs.
 *
 * - If `VITE_API_BASE_URL` is unset, we call same-origin endpoints (works with Vite proxy).
 * - If the API is hosted separately, set `VITE_API_BASE_URL=https://api.example.com`.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

export function apiUrl(pathname: string) {
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
}

