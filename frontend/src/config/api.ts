const DEFAULT_API_BASE = 'http://localhost:8000/api/v1';

export function normalizePublicApiBaseUrl(raw: string): string {
  let url = (raw || '').trim() || DEFAULT_API_BASE;
  url = url.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

export const API_CONFIG = {
  BASE_URL: normalizePublicApiBaseUrl(
    process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE,
  ),
  TIMEOUT: Number(process.env.NEXT_PUBLIC_API_TIMEOUT || 120000),
};
