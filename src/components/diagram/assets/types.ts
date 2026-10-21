/**
 * Unified Asset System Types
 * 
 * This module defines the types for the unified asset reference system,
 * which allows nodes to reference external assets (icons, Lottie, images)
 * by reference instead of embedding the full data.
 */

/**
 * Asset sources - where to fetch asset data from
 */
export type AssetSource =
  | 'iconify'        // Iconify API (e.g., "mdi:home", "carbon:database")
  | 'lottie-library' // Built-in Lottie animations (e.g., "confetti", "loading")
  | 'lottie-icons'   // Animated Lottie icons from catalog (e.g., "database", "api")
  | 'bundled'        // App-bundled assets (e.g., "/assets/shapes/star.svg")
  | 'url'            // External URL (e.g., "https://example.com/logo.png")
  | 'user'           // User-uploaded asset (stored in IndexedDB)
  | 'embedded';      // Data is inline (legacy/offline mode)

/**
 * Asset types
 */
export type AssetType = 'icon' | 'lottie' | 'image' | 'svg';

/**
 * Unified asset reference
 * 
 * This is the main type used in NodeModel to reference any type of asset.
 * It supports both reference-based (fetch on demand) and embedded (inline data) modes.
 * 
 * @example Reference-based icon (AI-generated)
 * ```json
 * {
 *   "type": "icon",
 *   "source": "iconify",
 *   "ref": "mdi:database"
 * }
 * ```
 * 
 * @example Embedded image (user upload)
 * ```json
 * {
 *   "type": "image",
 *   "source": "embedded",
 *   "data": "data:image/png;base64,..."
 * }
 * ```
 * 
 * @example Hybrid (reference + cached data for offline)
 * ```json
 * {
 *   "type": "icon",
 *   "source": "iconify",
 *   "ref": "mdi:database",
 *   "data": "<svg>...</svg>"
 * }
 * ```
 */
export interface AssetRef {
  /** What kind of asset this is */
  type: AssetType;

  /** Where to fetch the asset from */
  source: AssetSource;

  /**
   * Reference identifier (depends on source)
   * 
   * - iconify: "mdi:home", "carbon:database", "fluent:server-24-filled"
   * - lottie-library: "confetti", "loading-spinner", "success-check"
   * - bundled: "shapes/star.svg", "logos/company.png"
   * - url: "https://example.com/image.png"
   * - user: "user-asset-abc123" (IndexedDB key)
   * - embedded: undefined (data is inline)
   */
  ref?: string;

  /**
   * Embedded or cached asset data
   * 
   * - icon/svg: SVG string or parsed path data
   * - lottie: Lottie JSON object
   * - image: base64 data URL
   * 
   * When both `ref` and `data` exist, `data` serves as a cache/fallback
   * for offline use or failed fetches.
   */
  data?: string | object;

  /** Human-readable name for display */
  name?: string;

  /** Original source URL (for attribution or refresh) */
  originalUrl?: string;
}

/**
 * Resolved asset - the result of resolving an AssetRef
 */
export interface ResolvedAsset {
  /** The asset type */
  type: AssetType;

  /** The resolved data (SVG string, Lottie JSON, base64 image, etc.) */
  data: string | object;

  /** Whether this came from cache */
  fromCache: boolean;

  /** Error message if resolution failed */
  error?: string;
}

/**
 * Asset export modes for diagram export
 */
export type AssetExportMode =
  | 'reference'  // Only refs, smallest file, requires network
  | 'embedded'   // Only data, largest file, fully offline
  | 'hybrid';    // Both ref + data, medium size, offline fallback

/**
 * Export options for diagrams
 */
export interface AssetExportOptions {
  /** How to handle assets during export */
  assetMode: AssetExportMode;
}
