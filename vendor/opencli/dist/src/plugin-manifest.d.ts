/**
 * Plugin manifest: reads and validates opencli-plugin.json files.
 *
 * Supports two modes:
 * 1. Single plugin: repo root IS the plugin directory.
 * 2. Monorepo: repo contains multiple plugins declared in `plugins` field.
 */
export interface SubPluginEntry {
    /** Relative path from repo root to the sub-plugin directory. */
    path: string;
    version?: string;
    description?: string;
    /** Semver range for opencli compatibility (overrides top-level). */
    opencli?: string;
    /** When true, this sub-plugin is skipped during install. */
    disabled?: boolean;
}
export interface PluginManifest {
    /** Plugin name (single-plugin mode). */
    name?: string;
    /** Semantic version of the plugin (single-plugin mode). */
    version?: string;
    /** Semver range for opencli compatibility, e.g. ">=1.0.0". */
    opencli?: string;
    /** Human-readable description. */
    description?: string;
    /** Monorepo sub-plugins. Key = logical plugin name. */
    plugins?: Record<string, SubPluginEntry>;
}
export declare const MANIFEST_FILENAME = "opencli-plugin.json";
/**
 * Read and parse opencli-plugin.json from a directory.
 * Returns null if the file does not exist or is unparseable.
 */
export declare function readPluginManifest(dir: string): PluginManifest | null;
/** Returns true when the manifest declares a monorepo (has `plugins` field). */
export declare function isMonorepo(manifest: PluginManifest): boolean;
/**
 * Get the list of enabled sub-plugins from a monorepo manifest.
 * Returns entries sorted by key name.
 */
export declare function getEnabledPlugins(manifest: PluginManifest): Array<{
    name: string;
    entry: SubPluginEntry;
}>;
/**
 * Check if the current opencli version satisfies a semver range string.
 *
 * Supports a simplified subset of semver ranges:
 *   ">=1.0.0"   – greater than or equal
 *   "<=1.5.0"   – less than or equal
 *   ">1.0.0"    – strictly greater
 *   "<2.0.0"    – strictly less
 *   "^1.2.0"    – compatible (>=1.2.0 and <2.0.0)
 *   "~1.2.0"    – patch-level (>=1.2.0 and <1.3.0)
 *   "1.2.0"     – exact match
 *   ">=1.0.0 <2.0.0" – multiple constraints (space-separated, all must match)
 *
 * Returns true if compatible, false if not, and true for empty/undefined
 * ranges (no constraint = always compatible).
 */
export declare function checkCompatibility(range: string | undefined): boolean;
/** Parse a version string ("1.2.3") into [major, minor, patch]. */
export declare function parseVersion(version: string): [number, number, number] | null;
/**
 * Check if a version string satisfies a range expression.
 * Space-separated constraints are ANDed together.
 */
export declare function satisfiesRange(versionStr: string, range: string): boolean;
export { readPluginManifest as _readPluginManifest, isMonorepo as _isMonorepo, getEnabledPlugins as _getEnabledPlugins, checkCompatibility as _checkCompatibility, parseVersion as _parseVersion, satisfiesRange as _satisfiesRange, };
