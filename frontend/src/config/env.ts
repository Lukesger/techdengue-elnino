import { normalizePublicApiBaseUrl } from './api';

const getEnv = (key: string, defaultValue = ''): string => {
  if (typeof process === 'undefined') return defaultValue;
  const val = process.env?.[key];
  return typeof val === 'string' ? val : defaultValue;
};

export const ENV = {
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  NEXT_PUBLIC_API_URL: normalizePublicApiBaseUrl(
    getEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8000/api/v1'),
  ),
  NEXT_PUBLIC_MAPBOX_TOKEN: getEnv('NEXT_PUBLIC_MAPBOX_TOKEN', ''),
  MAPBOX_CONFIGURED: /^pk\.[A-Za-z0-9._-]+$/.test(
    getEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '').trim(),
  ),
  NEXT_PUBLIC_JWT_STORAGE_KEY: getEnv(
    'NEXT_PUBLIC_JWT_STORAGE_KEY',
    'techdengue_token',
  ),
};
