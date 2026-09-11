/**
 * CLI discovery: finds JS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers commands instantly. JS modules are loaded lazily only
 *    when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */
/** User runtime directory: ~/.opencli */
export declare const USER_OPENCLI_DIR: string;
/** User CLIs directory: ~/.opencli/clis */
export declare const USER_CLIS_DIR: string;
/** Plugins directory: ~/.opencli/plugins/ */
export declare const PLUGINS_DIR: string;
/**
 * Ensure ~/.opencli/node_modules/@jackwener/opencli symlink exists so that
 * user CLIs in ~/.opencli/clis/ can `import { cli } from '@jackwener/opencli/registry'`.
 *
 * This is the sole resolution mechanism — adapters use package exports
 * (e.g. `@jackwener/opencli/registry`, `@jackwener/opencli/errors`) and
 * Node.js resolves them through this symlink.
 */
export declare function ensureUserCliCompatShims(baseDir?: string): Promise<void>;
/**
 * Ensure the user adapters directory exists.
 *
 * With smart sync, ~/.opencli/clis/ only holds files that differ from the
 * package baseline (upstream-synced cache + autofix output + user overrides).
 * Built-in adapters are loaded directly from the installed package.
 */
export declare function ensureUserAdapters(): Promise<void>;
/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export declare function discoverClis(...dirs: string[]): Promise<void>;
/**
 * Discover and register plugins from ~/.opencli/plugins/.
 * Each subdirectory is treated as a plugin (site = directory name).
 * Files inside are scanned flat (no nested site subdirs).
 */
export declare function discoverPlugins(): Promise<void>;
