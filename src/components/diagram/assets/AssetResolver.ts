/**
 * Asset Resolver
 * 
 * Handles fetching and caching of assets from various sources.
 * Provides a unified interface for resolving asset references to actual data.
 */

import type { AssetRef, ResolvedAsset, AssetType } from './types';

/**
 * Convert a Blob to base64 data URL
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Get user asset from IndexedDB
 * TODO: Implement when user asset migration is done
 */
async function getUserAssetFromIndexedDB(assetId: string): Promise<string | object> {
  // Placeholder - will be implemented when user assets are migrated
  console.warn(`User asset lookup not yet implemented: ${assetId}`);
  throw new Error(`User asset not found: ${assetId}`);
}

/**
 * Asset Resolver class
 * 
 * Singleton that handles resolving asset references to actual data.
 * Implements caching to avoid redundant fetches.
 */
class AssetResolverImpl {
  private cache = new Map<string, ResolvedAsset>();
  private pendingFetches = new Map<string, Promise<ResolvedAsset>>();

  /**
   * Resolve an asset reference to actual data
   * 
   * @param asset - The asset reference to resolve
   * @returns The resolved asset with data
   */
  async resolve(asset: AssetRef): Promise<ResolvedAsset> {
    // 1. Embedded data — use directly
    if (asset.source === 'embedded' && asset.data) {
      return {
        type: asset.type,
        data: asset.data,
        fromCache: false,
      };
    }

    // 2. Has cached inline data — use it
    if (asset.data) {
      return {
        type: asset.type,
        data: asset.data,
        fromCache: true,
      };
    }

    // 3. No ref — can't resolve
    if (!asset.ref) {
      return {
        type: asset.type,
        data: '',
        fromCache: false,
        error: 'No ref or data provided',
      };
    }

    // 4. Check memory cache
    const cacheKey = `${asset.source}:${asset.ref}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // 5. Check if already fetching (dedup concurrent requests)
    const pending = this.pendingFetches.get(cacheKey);
    if (pending) {
      return pending;
    }

    // 6. Fetch from source
    const fetchPromise = this.fetchFromSource(asset)
      .then((data) => {
        const resolved: ResolvedAsset = {
          type: asset.type,
          data,
          fromCache: false,
        };
        // Cache it
        this.cache.set(cacheKey, resolved);
        this.pendingFetches.delete(cacheKey);
        return resolved;
      })
      .catch((error) => {
        this.pendingFetches.delete(cacheKey);
        return {
          type: asset.type,
          data: '',
          fromCache: false,
          error: error.message || 'Failed to fetch asset',
        };
      });

    this.pendingFetches.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Fetch asset data from the appropriate source
   */
  private async fetchFromSource(asset: AssetRef): Promise<string | object> {
    const ref = asset.ref!;

    switch (asset.source) {
      case 'iconify': {
        // mdi:home → mdi/home.svg
        const [prefix, name] = ref.split(':');
        if (!prefix || !name) {
          throw new Error(`Invalid iconify ref: ${ref}. Expected format: prefix:name`);
        }
        const url = `https://api.iconify.design/${prefix}/${name}.svg`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch icon: ${res.status} ${res.statusText}`);
        }
        return res.text();
      }

      case 'lottie-library': {
        // Fetch from bundled lottie library
        const url = `/lottie/${ref}.json`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch Lottie: ${res.status} ${res.statusText}`);
        }
        return res.json();
      }

      case 'lottie-icons': {
        // Fetch from Lottie icons CDN (animated icon library)
        const cdnUrl = `https://lottie-icons.tor1.digitaloceanspaces.com/lottie-icons/json/${ref}.json`;
        const res = await fetch(cdnUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch Lottie icon: ${res.status} ${res.statusText}`);
        }
        return res.json();
      }

      case 'bundled': {
        // Fetch from bundled assets
        const url = `/assets/${ref}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch bundled asset: ${res.status} ${res.statusText}`);
        }
        if (asset.type === 'lottie') {
          return res.json();
        }
        return res.text();
      }

      case 'url': {
        // Fetch from external URL
        const res = await fetch(ref);
        if (!res.ok) {
          throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
        }
        if (asset.type === 'lottie') {
          return res.json();
        }
        if (asset.type === 'image') {
          const blob = await res.blob();
          return blobToBase64(blob);
        }
        return res.text();
      }

      case 'user': {
        // Fetch from IndexedDB
        return getUserAssetFromIndexedDB(ref);
      }

      case 'embedded': {
        // Should not reach here - embedded assets have data inline
        throw new Error('Embedded asset has no data');
      }

      default:
        throw new Error(`Unknown asset source: ${asset.source}`);
    }
  }

  /**
   * Preload multiple assets (useful for diagram load)
   * 
   * @param assets - Array of asset references to preload
   */
  async preload(assets: AssetRef[]): Promise<void> {
    await Promise.allSettled(assets.map((a) => this.resolve(a)));
  }

  /**
   * Check if an asset is cached
   * 
   * @param asset - The asset reference to check
   * @returns true if the asset is in cache
   */
  isCached(asset: AssetRef): boolean {
    if (asset.data) return true;
    if (!asset.ref) return false;
    const cacheKey = `${asset.source}:${asset.ref}`;
    return this.cache.has(cacheKey);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Clear the cache (useful for memory management)
   */
  clearCache(): void {
    this.cache.clear();
    this.pendingFetches.clear();
  }

  /**
   * Remove a specific asset from cache
   * 
   * @param asset - The asset reference to remove from cache
   */
  invalidate(asset: AssetRef): void {
    if (!asset.ref) return;
    const cacheKey = `${asset.source}:${asset.ref}`;
    this.cache.delete(cacheKey);
  }
}

// Singleton instance
export const assetResolver = new AssetResolverImpl();

// Export type for testing/mocking
export type AssetResolver = typeof assetResolver;
