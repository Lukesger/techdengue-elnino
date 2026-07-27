import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/** Cache em memória (sem Redis) para o monorepo El Niño. */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly defaultTtl = 300_000;
  private readonly MAX_ENTRIES = 500;
  private cleanupTimer: NodeJS.Timeout | null = null;

  async onModuleInit(): Promise<void> {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    this.inflight.clear();
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs = this.defaultTtl): void {
    if (this.cache.size >= this.MAX_ENTRIES && !this.cache.has(key)) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  del(key: string): void {
    this.delete(key);
  }

  async getAsync<T>(key: string): Promise<T | null> {
    return this.get<T>(key);
  }

  async setAsync<T>(key: string, data: T, ttlMs = this.defaultTtl): Promise<void> {
    this.set(key, data, ttlMs);
  }

  generateKey(...parts: Array<string | number>): string {
    return parts.map(String).join(':');
  }

  async getOrSetAsync<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs = this.defaultTtl,
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== null) return hit;
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = factory()
      .then((data) => {
        this.set(key, data, ttlMs);
        return data;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, pending);
    return pending;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now > v.expiresAt) this.cache.delete(k);
    }
  }
}
