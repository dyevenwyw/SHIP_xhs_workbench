/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.opencli/plugins/<name>/.
 * Monorepo clones live in ~/.opencli/monorepos/<repo-name>/.
 * Install source format: "github:user/repo", "github:user/repo/subplugin",
 * "https://github.com/user/repo", "file:///local/plugin", or a local directory path.
 */
import * as fs from 'node:fs';
/** Path to the lock file that tracks installed plugin versions. */
export declare function getLockFilePath(): string;
/** Monorepo clones directory: ~/.opencli/monorepos/ */
export declare function getMonoreposDir(): string;
export type PluginSourceRecord = {
    kind: 'git';
    url: string;
} | {
    kind: 'local';
    path: string;
} | {
    kind: 'monorepo';
    url: string;
    repoName: string;
    subPath: string;
};
export interface LockEntry {
    source: PluginSourceRecord;
    commitHash: string;
    installedAt: string;
    updatedAt?: string;
}
export interface PluginInfo {
    name: string;
    path: string;
    commands: string[];
    source?: string;
    version?: string;
    installedAt?: string;
    /** If from a monorepo, the monorepo name. */
    monorepoName?: string;
    /** Description from opencli-plugin.json. */
    description?: string;
}
interface ParsedSource {
    type: 'git' | 'local';
    name: string;
    subPlugin?: string;
    cloneUrl?: string;
    localPath?: string;
}
declare function isLocalPluginSource(source?: string): boolean;
declare function toStoredPluginSource(source: PluginSourceRecord): string;
declare function toLocalPluginSource(pluginDir: string): string;
declare function resolvePluginSource(lockEntry: LockEntry | undefined, pluginDir: string): PluginSourceRecord | undefined;
declare function resolveStoredPluginSource(lockEntry: LockEntry | undefined, pluginDir: string): string | undefined;
/**
 * Move a directory, with EXDEV fallback.
 * fs.renameSync fails when source and destination are on different
 * filesystems (e.g. /tmp → ~/.opencli). In that case we copy then remove.
 */
type MoveDirFsOps = Pick<typeof fs, 'renameSync' | 'cpSync' | 'rmSync'>;
declare function moveDir(src: string, dest: string, fsOps?: MoveDirFsOps): void;
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
declare function readLockFileWithWriter(writeLock?: (lock: Record<string, LockEntry>) => void): Record<string, LockEntry>;
export declare function readLockFile(): Record<string, LockEntry>;
type WriteLockFileFsOps = Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'rmSync'>;
declare function writeLockFileWithFs(lock: Record<string, LockEntry>, fsOps?: WriteLockFileFsOps): void;
export declare function writeLockFile(lock: Record<string, LockEntry>): void;
/** Get the HEAD commit hash of a git repo directory. */
export declare function getCommitHash(dir: string): string | undefined;
/**
 * Validate that a downloaded plugin directory is a structurally valid plugin.
 * Checks for at least one command file (.ts, .js) and a valid
 * package.json if it contains .ts files.
 */
export declare function validatePluginStructure(pluginDir: string): ValidationResult;
declare function installDependencies(dir: string): void;
/**
 * Monorepo lifecycle: install shared deps at repo root, then install and finalize each sub-plugin.
 *
 * The root install covers monorepos that use npm workspaces to hoist dependencies.
 * For monorepos that do NOT use workspaces, sub-plugins may declare their own
 * production dependencies in their package.json.  We install those per sub-plugin
 * so that runtime imports (e.g. `undici`) can be resolved from the sub-plugin
 * directory.  When the root already satisfies all deps this is a fast no-op.
 */
declare function postInstallMonorepoLifecycle(repoDir: string, pluginDirs: string[]): void;
/**
 * Install a plugin from a source.
 * Supports:
 *   "github:user/repo"            — single plugin or full monorepo
 *   "github:user/repo/subplugin"  — specific sub-plugin from a monorepo
 *   "https://github.com/user/repo"
 *   "file:///absolute/path"       — local plugin directory (symlinked)
 *   "/absolute/path"              — local plugin directory (symlinked)
 *
 * Returns the installed plugin name(s).
 */
export declare function installPlugin(source: string): string | string[];
/**
 * Install a local plugin by creating a symlink.
 * Used for plugin development: the source directory is symlinked into
 * the plugins dir so changes are reflected immediately.
 */
declare function installLocalPlugin(localPath: string, name: string): string;
/**
 * Uninstall a plugin by name.
 * For monorepo sub-plugins: removes symlink and cleans up the monorepo
 * directory when no more sub-plugins reference it.
 */
export declare function uninstallPlugin(name: string): void;
/** Synchronous check if a path is a symlink. */
declare function isSymlinkSync(p: string): boolean;
/**
 * Update a plugin by name (git pull + re-install lifecycle).
 * For monorepo sub-plugins: pulls the monorepo root and re-runs lifecycle
 * for all sub-plugins from the same monorepo.
 */
export declare function updatePlugin(name: string): void;
export interface UpdateResult {
    name: string;
    success: boolean;
    error?: string;
}
/**
 * Update all installed plugins.
 * Continues even if individual plugin updates fail.
 */
export declare function updateAllPlugins(): UpdateResult[];
/**
 * List all installed plugins.
 * Reads opencli-plugin.json for description/version when available.
 */
export declare function listPlugins(): PluginInfo[];
/** Parse a plugin source string into clone URL, repo name, and optional sub-plugin. */
declare function parseSource(source: string): ParsedSource | null;
/**
 * Resolve the path to the esbuild CLI executable with fallback strategies.
 */
export declare function resolveEsbuildBin(): string | null;
declare function resolveHostOpencliRoot(startFile?: string): string;
export { resolveHostOpencliRoot as _resolveHostOpencliRoot, resolveEsbuildBin as _resolveEsbuildBin, getCommitHash as _getCommitHash, installDependencies as _installDependencies, parseSource as _parseSource, postInstallMonorepoLifecycle as _postInstallMonorepoLifecycle, readLockFile as _readLockFile, readLockFileWithWriter as _readLockFileWithWriter, updateAllPlugins as _updateAllPlugins, validatePluginStructure as _validatePluginStructure, writeLockFile as _writeLockFile, writeLockFileWithFs as _writeLockFileWithFs, isSymlinkSync as _isSymlinkSync, getMonoreposDir as _getMonoreposDir, installLocalPlugin as _installLocalPlugin, isLocalPluginSource as _isLocalPluginSource, moveDir as _moveDir, resolvePluginSource as _resolvePluginSource, resolveStoredPluginSource as _resolveStoredPluginSource, toStoredPluginSource as _toStoredPluginSource, toLocalPluginSource as _toLocalPluginSource, };
