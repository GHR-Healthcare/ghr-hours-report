import { databaseService } from './database';

class ConfigService {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minute cache TTL

  /**
   * Get a config value. Checks:
   * 1. In-memory cache (if not expired)
   * 2. Database app_config table
   * 3. process.env fallback
   * 4. Hardcoded default (if provided)
   */
  async get(key: string, defaultValue: string = ''): Promise<string> {
    // 1. Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // 2. Check database
    try {
      const dbValue = await databaseService.getConfigValue(key);
      if (dbValue !== null) {
        this.cache.set(key, { value: dbValue, expiresAt: Date.now() + this.TTL_MS });
        return dbValue;
      }
    } catch (error) {
      console.warn(`Config DB lookup failed for ${key}, falling back to env var:`, error);
    }

    // 3. Check env var
    const envValue = process.env[key];
    if (envValue !== undefined) {
      return envValue;
    }

    // 4. Return default
    return defaultValue;
  }

  /**
   * Get a config value split by comma (for recipient lists).
   * Returns a trimmed, non-empty array of strings.
   */
  async getList(key: string): Promise<string[]> {
    const raw = await this.get(key, '');
    return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Invalidate a specific key from cache (call after upsert/delete).
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate entire cache.
   */
  invalidateAll(): void {
    this.cache.clear();
  }
}

export const configService = new ConfigService();
