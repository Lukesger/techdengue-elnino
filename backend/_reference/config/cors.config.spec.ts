import {
  isCorsOriginAllowed,
  parseCorsOriginsFromEnv,
  resolveCorsAllowedOriginHeader,
} from './cors.config';

describe('cors.config', () => {
  const baseEnv = {
    CORS_ORIGIN: 'https://app.example.com',
    NODE_ENV: 'production',
  } as NodeJS.ProcessEnv;

  it('parseia origens separadas por vírgula', () => {
    expect(
      parseCorsOriginsFromEnv({
        CORS_ORIGIN: 'https://a.com, https://b.com ',
      }),
    ).toEqual(['https://a.com', 'https://b.com']);
  });

  it('permite origem na allowlist em produção', () => {
    expect(isCorsOriginAllowed('https://app.example.com', baseEnv)).toBe(true);
  });

  it('nega origem fora da allowlist em produção', () => {
    expect(isCorsOriginAllowed('https://evil.com', baseEnv)).toBe(false);
  });

  it('resolve header apenas para origem permitida', () => {
    expect(
      resolveCorsAllowedOriginHeader('https://app.example.com', baseEnv),
    ).toBe('https://app.example.com');
    expect(resolveCorsAllowedOriginHeader('https://evil.com', baseEnv)).toBe(
      false,
    );
  });

  it('permite origem da LAN em desenvolvimento', () => {
    const devEnv = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(isCorsOriginAllowed('http://192.168.31.215:3001', devEnv)).toBe(
      true,
    );
    expect(isCorsOriginAllowed('http://10.0.0.5:3001', devEnv)).toBe(true);
  });

  it('nega origem da LAN em produção sem allowlist', () => {
    expect(
      isCorsOriginAllowed('http://192.168.31.215:3001', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
