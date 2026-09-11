/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.opencli/plugins/<name>/.
 * Monorepo clones live in ~/.opencli/monorepos/<repo-name>/.
 * Install source format: "github:user/repo", "github:user/repo/subplugin",
 * "https://github.com/user/repo", "file:///local/plugin", or a local directory path.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLUGINS_DIR } from './discovery.js';
import { getErrorMessage, PluginError } from './errors.js';
import { log } from './logger.js';
import { isRecord } from './utils.js';
import { readPluginManifest, isMonorepo, getEnabledPlugins, checkCompatibility, } from './plugin-manifest.js';
const isWindows = process.platform === 'win32';
const LOCAL_PLUGIN_SOURCE_PREFIX = 'local:';
/** Get home directory, respecting HOME environment variable for test isolation. */
function getHomeDir() {
    return process.env.HOME || process.env.USERPROFILE || os.homedir();
}
/** Path to the lock file that tracks installed plugin versions. */
export function getLockFilePath() {
    return path.join(getHomeDir(), '.opencli', 'plugins.lock.json');
}
/** Monorepo clones directory: ~/.opencli/monorepos/ */
export function getMonoreposDir() {
    return path.join(getHomeDir(), '.opencli', 'monorepos');
}
function parseStoredPluginSource(source) {
    if (!source)
        return undefined;
    if (source.startsWith(LOCAL_PLUGIN_SOURCE_PREFIX)) {
        return {
            kind: 'local',
            path: path.resolve(source.slice(LOCAL_PLUGIN_SOURCE_PREFIX.length)),
        };
    }
    return { kind: 'git', url: source };
}
function isLocalPluginSource(source) {
    return parseStoredPluginSource(source)?.kind === 'local';
}
function toStoredPluginSource(source) {
    if (source.kind === 'local') {
        return `${LOCAL_PLUGIN_SOURCE_PREFIX}${path.resolve(source.path)}`;
    }
    return source.url;
}
function toLocalPluginSource(pluginDir) {
    return toStoredPluginSource({ kind: 'local', path: pluginDir });
}
// isRecord is imported from './utils.js'
function normalizeLegacyMonorepo(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.name !== 'string' || typeof value.subPath !== 'string')
        return undefined;
    return { name: value.name, subPath: value.subPath };
}
function normalizePluginSource(source, legacyMonorepo) {
    if (typeof source === 'string') {
        const parsed = parseStoredPluginSource(source);
        if (!parsed)
            return undefined;
        if (parsed.kind === 'git' && legacyMonorepo) {
            return {
                kind: 'monorepo',
                url: parsed.url,
                repoName: legacyMonorepo.name,
                subPath: legacyMonorepo.subPath,
            };
        }
        return parsed;
    }
    if (!isRecord(source) || typeof source.kind !== 'string')
        return undefined;
    switch (source.kind) {
        case 'git':
            return typeof source.url === 'string'
                ? { kind: 'git', url: source.url }
                : undefined;
        case 'local':
            return typeof source.path === 'string'
                ? { kind: 'local', path: path.resolve(source.path) }
                : undefined;
        case 'monorepo':
            return typeof source.url === 'string'
                && typeof source.repoName === 'string'
                && typeof source.subPath === 'string'
                ? {
                    kind: 'monorepo',
                    url: source.url,
                    repoName: source.repoName,
                    subPath: source.subPath,
                }
                : undefined;
        default:
            return undefined;
    }
}
function normalizeLockEntry(value) {
    if (!isRecord(value))
        return undefined;
    const legacyMonorepo = normalizeLegacyMonorepo(value.monorepo);
    const source = normalizePluginSource(value.source, legacyMonorepo);
    if (!source)
        return undefined;
    if (typeof value.commitHash !== 'string' || typeof value.installedAt !== 'string') {
        return undefined;
    }
    const entry = {
        source,
        commitHash: value.commitHash,
        installedAt: value.installedAt,
    };
    if (typeof value.updatedAt === 'string') {
        entry.updatedAt = value.updatedAt;
    }
    return entry;
}
function resolvePluginSource(lockEntry, pluginDir) {
    if (lockEntry) {
        return lockEntry.source;
    }
    return parseStoredPluginSource(getPluginSource(pluginDir));
}
function resolveStoredPluginSource(lockEntry, pluginDir) {
    const source = resolvePluginSource(lockEntry, pluginDir);
    return source ? toStoredPluginSource(source) : undefined;
}
function moveDir(src, dest, fsOps = fs) {
    try {
        fsOps.renameSync(src, dest);
    }
    catch (err) {
        if (err.code === 'EXDEV') {
            try {
                fsOps.cpSync(src, dest, { recursive: true });
            }
            catch (copyErr) {
                try {
                    fsOps.rmSync(dest, { recursive: true, force: true });
                }
                catch { }
                throw copyErr;
            }
            fsOps.rmSync(src, { recursive: true, force: true });
        }
        else {
            throw err;
        }
    }
}
function createSiblingTempPath(dest, kind) {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return path.join(path.dirname(dest), `.${path.basename(dest)}.${kind}-${suffix}`);
}
function cloneRepoToTemp(cloneUrl) {
    const tmpCloneDir = path.join(os.tmpdir(), `opencli-clone-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
        execFileSync('git', ['clone', '--depth', '1', cloneUrl, tmpCloneDir], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    catch (err) {
        throw new PluginError(`Failed to clone plugin: ${getErrorMessage(err)}`, 'Check the repository URL and your network connection.');
    }
    return tmpCloneDir;
}
function withTempClone(cloneUrl, work) {
    const tmpCloneDir = cloneRepoToTemp(cloneUrl);
    try {
        return work(tmpCloneDir);
    }
    finally {
        try {
            fs.rmSync(tmpCloneDir, { recursive: true, force: true });
        }
        catch { }
    }
}
function resolveRemotePluginSource(lockEntry, dir) {
    const source = resolvePluginSource(lockEntry, dir);
    if (!source || source.kind === 'local') {
        throw new Error(`Unable to determine remote source for plugin at ${dir}`);
    }
    return source.url;
}
function pathExistsSync(p) {
    try {
        fs.lstatSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function resolveRepoContainedPath(repoRoot, subPath) {
    const resolved = path.resolve(repoRoot, subPath);
    if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
        throw new PluginError(`Plugin path "${subPath}" escapes repo root.`);
    }
    return resolved;
}
function removePathSync(p) {
    try {
        const stat = fs.lstatSync(p);
        if (stat.isSymbolicLink()) {
            fs.unlinkSync(p);
            return;
        }
        fs.rmSync(p, { recursive: true, force: true });
    }
    catch { }
}
class Transaction {
    #handles = [];
    #settled = false;
    track(handle) {
        this.#handles.push(handle);
        return handle;
    }
    commit() {
        if (this.#settled)
            return;
        this.#settled = true;
        for (const handle of this.#handles) {
            handle.finalize();
        }
    }
    rollback() {
        if (this.#settled)
            return;
        this.#settled = true;
        for (const handle of [...this.#handles].reverse()) {
            handle.rollback();
        }
    }
}
function runTransaction(work) {
    const tx = new Transaction();
    try {
        const result = work(tx);
        tx.commit();
        return result;
    }
    catch (err) {
        tx.rollback();
        throw err;
    }
}
function beginReplaceDir(stagingDir, dest, fsOps = fs) {
    const destExisted = fsOps.existsSync(dest);
    fsOps.mkdirSync(path.dirname(dest), { recursive: true });
    const tempDest = createSiblingTempPath(dest, 'tmp');
    const backupDest = destExisted ? createSiblingTempPath(dest, 'bak') : null;
    let settled = false;
    try {
        moveDir(stagingDir, tempDest, fsOps);
        if (backupDest) {
            fsOps.renameSync(dest, backupDest);
        }
        fsOps.renameSync(tempDest, dest);
    }
    catch (err) {
        try {
            fsOps.rmSync(tempDest, { recursive: true, force: true });
        }
        catch { }
        if (backupDest && !fsOps.existsSync(dest)) {
            try {
                fsOps.renameSync(backupDest, dest);
            }
            catch { }
        }
        throw err;
    }
    return {
        finalize() {
            if (settled)
                return;
            settled = true;
            if (backupDest) {
                try {
                    fsOps.rmSync(backupDest, { recursive: true, force: true });
                }
                catch { }
            }
        },
        rollback() {
            if (settled)
                return;
            settled = true;
            try {
                fsOps.rmSync(dest, { recursive: true, force: true });
            }
            catch { }
            if (backupDest) {
                try {
                    fsOps.renameSync(backupDest, dest);
                }
                catch { }
            }
            try {
                fsOps.rmSync(tempDest, { recursive: true, force: true });
            }
            catch { }
        },
    };
}
function beginReplaceSymlink(target, linkPath) {
    const linkExists = pathExistsSync(linkPath);
    if (linkExists && !isSymlinkSync(linkPath)) {
        throw new Error(`Expected monorepo plugin link at ${linkPath} to be a symlink`);
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    const tempLink = createSiblingTempPath(linkPath, 'tmp');
    const backupLink = linkExists ? createSiblingTempPath(linkPath, 'bak') : null;
    const linkType = isWindows ? 'junction' : 'dir';
    let settled = false;
    try {
        fs.symlinkSync(target, tempLink, linkType);
        if (backupLink) {
            fs.renameSync(linkPath, backupLink);
        }
        fs.renameSync(tempLink, linkPath);
    }
    catch (err) {
        removePathSync(tempLink);
        if (backupLink && !pathExistsSync(linkPath)) {
            try {
                fs.renameSync(backupLink, linkPath);
            }
            catch { }
        }
        throw err;
    }
    return {
        finalize() {
            if (settled)
                return;
            settled = true;
            if (backupLink) {
                removePathSync(backupLink);
            }
        },
        rollback() {
            if (settled)
                return;
            settled = true;
            removePathSync(linkPath);
            if (backupLink && !pathExistsSync(linkPath)) {
                try {
                    fs.renameSync(backupLink, linkPath);
                }
                catch { }
            }
            removePathSync(tempLink);
        },
    };
}
// ── Lock file helpers ───────────────────────────────────────────────────────
function readLockFileWithWriter(writeLock = writeLockFile) {
    try {
        const raw = fs.readFileSync(getLockFilePath(), 'utf-8');
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed))
            return {};
        const lock = {};
        let changed = false;
        for (const [name, entry] of Object.entries(parsed)) {
            const normalized = normalizeLockEntry(entry);
            if (!normalized) {
                changed = true;
                continue;
            }
            lock[name] = normalized;
            if (JSON.stringify(entry) !== JSON.stringify(normalized)) {
                changed = true;
            }
        }
        if (changed) {
            try {
                writeLock(lock);
            }
            catch { }
        }
        return lock;
    }
    catch {
        return {};
    }
}
export function readLockFile() {
    return readLockFileWithWriter(writeLockFile);
}
function writeLockFileWithFs(lock, fsOps = fs) {
    const lockPath = getLockFilePath();
    fsOps.mkdirSync(path.dirname(lockPath), { recursive: true });
    const tempPath = createSiblingTempPath(lockPath, 'tmp');
    try {
        fsOps.writeFileSync(tempPath, JSON.stringify(lock, null, 2) + '\n');
        fsOps.renameSync(tempPath, lockPath);
    }
    catch (err) {
        try {
            fsOps.rmSync(tempPath, { force: true });
        }
        catch { }
        throw err;
    }
}
export function writeLockFile(lock) {
    writeLockFileWithFs(lock, fs);
}
/** Get the HEAD commit hash of a git repo directory. */
export function getCommitHash(dir) {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return undefined;
    }
}
/**
 * Validate that a downloaded plugin directory is a structurally valid plugin.
 * Checks for at least one command file (.ts, .js) and a valid
 * package.json if it contains .ts files.
 */
export function validatePluginStructure(pluginDir) {
    const errors = [];
    if (!fs.existsSync(pluginDir)) {
        return { valid: false, errors: ['Plugin directory does not exist'] };
    }
    const files = fs.readdirSync(pluginDir);
    const hasTs = files.some(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'));
    const hasJs = files.some(f => f.endsWith('.js') && !f.endsWith('.d.js'));
    if (!hasTs && !hasJs) {
        errors.push('No command files found in plugin directory. A plugin must contain at least one .ts or .js command file.');
    }
    if (hasTs) {
        const pkgJsonPath = path.join(pluginDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) {
            errors.push('Plugin contains .ts files but no package.json. A package.json with "type": "module" and "@jackwener/opencli" peer dependency is required for TS plugins.');
        }
        else {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                if (pkg.type !== 'module') {
                    errors.push('Plugin package.json must have "type": "module" for TypeScript plugins.');
                }
            }
            catch {
                errors.push('Plugin package.json is malformed or invalid JSON.');
            }
        }
    }
    return { valid: errors.length === 0, errors };
}
/** Check whether a directory has its own production dependencies in package.json. */
function hasOwnDependencies(dir) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath))
        return false;
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.dependencies != null && Object.keys(pkg.dependencies).length > 0;
    }
    catch {
        return false;
    }
}
function installDependencies(dir) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgJsonPath))
        return;
    try {
        // --ignore-scripts is a security boundary, not an optimization: the plugin
        // repo was just cloned from an untrusted third-party Git URL, and without
        // this flag npm would execute preinstall/install/postinstall lifecycle
        // scripts declared by the plugin (and every transitive dep) with the user's
        // privileges at install time. Adapter plugins don't need lifecycle scripts
        // to work — the adapter code is loaded later by the discovery path — so we
        // deny that extra execution vector unconditionally. See issue #1753.
        execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            ...(isWindows && { shell: true }),
        });
    }
    catch (err) {
        throw new PluginError(`npm install failed in ${dir}: ${getErrorMessage(err)}`, 'Check your network connection and npm configuration.');
    }
}
function finalizePluginRuntime(pluginDir) {
    // Symlink host opencli so TS plugins resolve '@jackwener/opencli/registry'
    // against the running host, not a stale npm-published version.
    linkHostOpencli(pluginDir);
    // Transpile .ts → .js via esbuild (production node can't load .ts directly).
    transpilePluginTs(pluginDir);
}
/**
 * Shared post-install lifecycle for standalone plugins.
 */
function postInstallLifecycle(pluginDir) {
    installDependencies(pluginDir);
    finalizePluginRuntime(pluginDir);
}
/**
 * Monorepo lifecycle: install shared deps at repo root, then install and finalize each sub-plugin.
 *
 * The root install covers monorepos that use npm workspaces to hoist dependencies.
 * For monorepos that do NOT use workspaces, sub-plugins may declare their own
 * production dependencies in their package.json.  We install those per sub-plugin
 * so that runtime imports (e.g. `undici`) can be resolved from the sub-plugin
 * directory.  When the root already satisfies all deps this is a fast no-op.
 */
function postInstallMonorepoLifecycle(repoDir, pluginDirs) {
    installDependencies(repoDir);
    for (const pluginDir of pluginDirs) {
        if (pluginDir !== repoDir && hasOwnDependencies(pluginDir)) {
            installDependencies(pluginDir);
        }
        finalizePluginRuntime(pluginDir);
    }
}
function ensureStandalonePluginReady(pluginDir) {
    const validation = validatePluginStructure(pluginDir);
    if (!validation.valid) {
        throw new PluginError(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
    }
    postInstallLifecycle(pluginDir);
}
function upsertLockEntry(lock, name, entry) {
    lock[name] = {
        ...entry,
        installedAt: entry.installedAt ?? new Date().toISOString(),
    };
}
function publishStandalonePlugin(stagingDir, targetDir, writeLock) {
    runTransaction((tx) => {
        tx.track(beginReplaceDir(stagingDir, targetDir));
        writeLock(getCommitHash(targetDir));
    });
}
function publishMonorepoPlugins(repoDir, pluginsDir, plugins, publishRepo, writeLock) {
    runTransaction((tx) => {
        if (publishRepo) {
            fs.mkdirSync(publishRepo.parentDir, { recursive: true });
            tx.track(beginReplaceDir(publishRepo.stagingDir, repoDir));
        }
        const commitHash = getCommitHash(repoDir);
        for (const plugin of plugins) {
            const linkPath = path.join(pluginsDir, plugin.name);
            const subDir = resolveRepoContainedPath(repoDir, plugin.subPath);
            tx.track(beginReplaceSymlink(subDir, linkPath));
        }
        writeLock?.(commitHash);
    });
}
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
export function installPlugin(source) {
    const parsed = parseSource(source);
    if (!parsed) {
        throw new Error(`Invalid plugin source: "${source}"\n` +
            `Supported formats:\n` +
            `  github:user/repo\n` +
            `  github:user/repo/subplugin\n` +
            `  https://github.com/user/repo\n` +
            `  https://<host>/<path>/repo.git\n` +
            `  ssh://git@<host>/<path>/repo.git\n` +
            `  git@<host>:user/repo.git\n` +
            `  file:///absolute/path\n` +
            `  /absolute/path`);
    }
    const { name: repoName, subPlugin } = parsed;
    if (parsed.type === 'local') {
        return installLocalPlugin(parsed.localPath, repoName);
    }
    return withTempClone(parsed.cloneUrl, (tmpCloneDir) => {
        const manifest = readPluginManifest(tmpCloneDir);
        // Check top-level compatibility
        if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
            throw new Error(`Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`);
        }
        if (manifest && isMonorepo(manifest)) {
            return installMonorepo(tmpCloneDir, parsed.cloneUrl, repoName, manifest, subPlugin);
        }
        // Single plugin mode
        return installSinglePlugin(tmpCloneDir, parsed.cloneUrl, repoName, manifest);
    });
}
/** Install a single (non-monorepo) plugin. */
function installSinglePlugin(cloneDir, cloneUrl, name, manifest) {
    const pluginName = manifest?.name ?? name;
    const targetDir = path.join(PLUGINS_DIR, pluginName);
    if (fs.existsSync(targetDir)) {
        throw new PluginError(`Plugin "${pluginName}" is already installed at ${targetDir}`, 'Use "opencli plugin uninstall" first, or pick a different name.');
    }
    ensureStandalonePluginReady(cloneDir);
    publishStandalonePlugin(cloneDir, targetDir, (commitHash) => {
        const lock = readLockFile();
        if (commitHash) {
            upsertLockEntry(lock, pluginName, {
                source: { kind: 'git', url: cloneUrl },
                commitHash,
            });
            writeLockFile(lock);
        }
    });
    return pluginName;
}
/**
 * Install a local plugin by creating a symlink.
 * Used for plugin development: the source directory is symlinked into
 * the plugins dir so changes are reflected immediately.
 */
function installLocalPlugin(localPath, name) {
    if (!fs.existsSync(localPath)) {
        throw new PluginError(`Local plugin path does not exist: ${localPath}`);
    }
    const stat = fs.statSync(localPath);
    if (!stat.isDirectory()) {
        throw new PluginError(`Local plugin path is not a directory: ${localPath}`);
    }
    const manifest = readPluginManifest(localPath);
    if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
        throw new PluginError(`Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`, 'Upgrade opencli to a compatible version.');
    }
    const pluginName = manifest?.name ?? name;
    const targetDir = path.join(PLUGINS_DIR, pluginName);
    if (fs.existsSync(targetDir)) {
        throw new PluginError(`Plugin "${pluginName}" is already installed at ${targetDir}`, 'Use "opencli plugin uninstall" first, or pick a different name.');
    }
    const validation = validatePluginStructure(localPath);
    if (!validation.valid) {
        throw new PluginError(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
    }
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    const resolvedPath = path.resolve(localPath);
    const linkType = isWindows ? 'junction' : 'dir';
    fs.symlinkSync(resolvedPath, targetDir, linkType);
    installDependencies(localPath);
    finalizePluginRuntime(localPath);
    const lock = readLockFile();
    const commitHash = getCommitHash(localPath);
    upsertLockEntry(lock, pluginName, {
        source: { kind: 'local', path: resolvedPath },
        commitHash: commitHash ?? 'local',
    });
    writeLockFile(lock);
    return pluginName;
}
function updateLocalPlugin(name, targetDir, lock, lockEntry) {
    const pluginDir = fs.realpathSync(targetDir);
    const validation = validatePluginStructure(pluginDir);
    if (!validation.valid) {
        log.warn(`Plugin "${name}" structure invalid:\n- ${validation.errors.join('\n- ')}`);
    }
    postInstallLifecycle(pluginDir);
    upsertLockEntry(lock, name, {
        source: lockEntry?.source ?? { kind: 'local', path: pluginDir },
        commitHash: getCommitHash(pluginDir) ?? 'local',
        installedAt: lockEntry?.installedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    writeLockFile(lock);
}
/** Install sub-plugins from a monorepo. */
function installMonorepo(cloneDir, cloneUrl, repoName, manifest, subPlugin) {
    const monoreposDir = getMonoreposDir();
    const repoDir = path.join(monoreposDir, repoName);
    const repoAlreadyInstalled = fs.existsSync(repoDir);
    const repoRoot = repoAlreadyInstalled ? repoDir : cloneDir;
    const effectiveManifest = repoAlreadyInstalled ? readPluginManifest(repoDir) : manifest;
    if (!effectiveManifest || !isMonorepo(effectiveManifest)) {
        throw new PluginError(`Monorepo manifest missing or invalid at ${repoRoot}`);
    }
    let pluginsToInstall = getEnabledPlugins(effectiveManifest);
    // If a specific sub-plugin was requested, filter to just that one
    if (subPlugin) {
        pluginsToInstall = pluginsToInstall.filter((p) => p.name === subPlugin);
        if (pluginsToInstall.length === 0) {
            // Check if it exists but is disabled
            const disabled = effectiveManifest.plugins?.[subPlugin];
            if (disabled) {
                throw new PluginError(`Sub-plugin "${subPlugin}" is disabled in the manifest.`);
            }
            throw new PluginError(`Sub-plugin "${subPlugin}" not found in monorepo. Available: ${Object.keys(effectiveManifest.plugins ?? {}).join(', ')}`);
        }
    }
    const installedNames = [];
    const lock = readLockFile();
    const eligiblePlugins = [];
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    for (const { name, entry } of pluginsToInstall) {
        // Check sub-plugin level compatibility (overrides top-level)
        if (entry.opencli && !checkCompatibility(entry.opencli)) {
            log.warn(`Skipping "${name}": requires opencli ${entry.opencli}`);
            continue;
        }
        let subDir;
        try {
            subDir = resolveRepoContainedPath(repoRoot, entry.path);
        }
        catch {
            log.warn(`Skipping "${name}": path "${entry.path}" escapes repo root.`);
            continue;
        }
        if (!fs.existsSync(subDir)) {
            log.warn(`Skipping "${name}": path "${entry.path}" not found in repo.`);
            continue;
        }
        const validation = validatePluginStructure(subDir);
        if (!validation.valid) {
            log.warn(`Skipping "${name}": invalid structure — ${validation.errors.join(', ')}`);
            continue;
        }
        const linkPath = path.join(PLUGINS_DIR, name);
        if (fs.existsSync(linkPath)) {
            log.warn(`Skipping "${name}": already installed at ${linkPath}`);
            continue;
        }
        eligiblePlugins.push({ name, entry });
    }
    if (eligiblePlugins.length === 0) {
        return installedNames;
    }
    const publishPlugins = eligiblePlugins.map(({ name, entry }) => ({ name, subPath: entry.path }));
    if (repoAlreadyInstalled) {
        postInstallMonorepoLifecycle(repoDir, eligiblePlugins.map((p) => resolveRepoContainedPath(repoDir, p.entry.path)));
    }
    else {
        postInstallMonorepoLifecycle(cloneDir, eligiblePlugins.map((p) => resolveRepoContainedPath(cloneDir, p.entry.path)));
    }
    publishMonorepoPlugins(repoDir, PLUGINS_DIR, publishPlugins, repoAlreadyInstalled ? undefined : { stagingDir: cloneDir, parentDir: monoreposDir }, (commitHash) => {
        for (const { name, entry } of eligiblePlugins) {
            if (commitHash) {
                upsertLockEntry(lock, name, {
                    source: {
                        kind: 'monorepo',
                        url: cloneUrl,
                        repoName,
                        subPath: entry.path,
                    },
                    commitHash,
                });
            }
            installedNames.push(name);
        }
        writeLockFile(lock);
    });
    return installedNames;
}
function collectUpdatedMonorepoPlugins(monoName, lock, manifest, cloneUrl, tmpCloneDir) {
    const updatedPlugins = [];
    for (const [pluginName, entry] of Object.entries(lock)) {
        if (entry.source.kind !== 'monorepo' || entry.source.repoName !== monoName)
            continue;
        const manifestEntry = manifest.plugins?.[pluginName];
        if (!manifestEntry || manifestEntry.disabled) {
            throw new Error(`Installed sub-plugin "${pluginName}" no longer exists in ${cloneUrl}`);
        }
        if (manifestEntry.opencli && !checkCompatibility(manifestEntry.opencli)) {
            throw new Error(`Sub-plugin "${pluginName}" requires opencli ${manifestEntry.opencli}`);
        }
        const subDir = resolveRepoContainedPath(tmpCloneDir, manifestEntry.path);
        const validation = validatePluginStructure(subDir);
        if (!validation.valid) {
            throw new Error(`Updated sub-plugin "${pluginName}" is invalid:\n- ${validation.errors.join('\n- ')}`);
        }
        updatedPlugins.push({ name: pluginName, lockEntry: entry, manifestEntry });
    }
    return updatedPlugins;
}
function updateMonorepoLockEntries(lock, plugins, cloneUrl, monoName, commitHash) {
    for (const plugin of plugins) {
        if (!commitHash)
            continue;
        upsertLockEntry(lock, plugin.name, {
            ...plugin.lockEntry,
            source: {
                kind: 'monorepo',
                url: cloneUrl,
                repoName: monoName,
                subPath: plugin.manifestEntry.path,
            },
            commitHash,
            updatedAt: new Date().toISOString(),
        });
    }
}
function updateStandaloneLockEntry(lock, name, cloneUrl, existing, commitHash) {
    if (!commitHash)
        return;
    upsertLockEntry(lock, name, {
        source: { kind: 'git', url: cloneUrl },
        commitHash,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}
/**
 * Uninstall a plugin by name.
 * For monorepo sub-plugins: removes symlink and cleans up the monorepo
 * directory when no more sub-plugins reference it.
 */
export function uninstallPlugin(name) {
    const targetDir = path.join(PLUGINS_DIR, name);
    if (!fs.existsSync(targetDir)) {
        throw new Error(`Plugin "${name}" is not installed.`);
    }
    const lock = readLockFile();
    const lockEntry = lock[name];
    // Check if this is a symlink (monorepo sub-plugin)
    const isSymlink = isSymlinkSync(targetDir);
    if (isSymlink) {
        // Remove symlink only (not the actual directory)
        fs.unlinkSync(targetDir);
    }
    else {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    // Clean up monorepo directory if no more sub-plugins reference it
    if (lockEntry?.source.kind === 'monorepo') {
        delete lock[name];
        const monoName = lockEntry.source.repoName;
        const stillReferenced = Object.values(lock).some((entry) => entry.source.kind === 'monorepo' && entry.source.repoName === monoName);
        if (!stillReferenced) {
            const monoDir = path.join(getMonoreposDir(), monoName);
            try {
                fs.rmSync(monoDir, { recursive: true, force: true });
            }
            catch { }
        }
    }
    else if (lock[name]) {
        delete lock[name];
    }
    writeLockFile(lock);
}
/** Synchronous check if a path is a symlink. */
function isSymlinkSync(p) {
    try {
        return fs.lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
}
/**
 * Update a plugin by name (git pull + re-install lifecycle).
 * For monorepo sub-plugins: pulls the monorepo root and re-runs lifecycle
 * for all sub-plugins from the same monorepo.
 */
export function updatePlugin(name) {
    const targetDir = path.join(PLUGINS_DIR, name);
    if (!fs.existsSync(targetDir)) {
        throw new Error(`Plugin "${name}" is not installed.`);
    }
    const lock = readLockFile();
    const lockEntry = lock[name];
    const source = resolvePluginSource(lockEntry, targetDir);
    if (source?.kind === 'local') {
        updateLocalPlugin(name, targetDir, lock, lockEntry);
        return;
    }
    if (source?.kind === 'monorepo') {
        const monoDir = path.join(getMonoreposDir(), source.repoName);
        const monoName = source.repoName;
        const cloneUrl = source.url;
        withTempClone(cloneUrl, (tmpCloneDir) => {
            const manifest = readPluginManifest(tmpCloneDir);
            if (!manifest || !isMonorepo(manifest)) {
                throw new Error(`Updated source is no longer a monorepo: ${cloneUrl}`);
            }
            if (manifest.opencli && !checkCompatibility(manifest.opencli)) {
                throw new Error(`Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`);
            }
            const updatedPlugins = collectUpdatedMonorepoPlugins(monoName, lock, manifest, cloneUrl, tmpCloneDir);
            if (updatedPlugins.length > 0) {
                postInstallMonorepoLifecycle(tmpCloneDir, updatedPlugins.map((plugin) => resolveRepoContainedPath(tmpCloneDir, plugin.manifestEntry.path)));
            }
            publishMonorepoPlugins(monoDir, PLUGINS_DIR, updatedPlugins.map((plugin) => ({ name: plugin.name, subPath: plugin.manifestEntry.path })), { stagingDir: tmpCloneDir, parentDir: path.dirname(monoDir) }, (commitHash) => {
                updateMonorepoLockEntries(lock, updatedPlugins, cloneUrl, monoName, commitHash);
                writeLockFile(lock);
            });
        });
        return;
    }
    const cloneUrl = resolveRemotePluginSource(lockEntry, targetDir);
    withTempClone(cloneUrl, (tmpCloneDir) => {
        const manifest = readPluginManifest(tmpCloneDir);
        if (manifest && isMonorepo(manifest)) {
            throw new Error(`Updated source is now a monorepo: ${cloneUrl}`);
        }
        if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
            throw new Error(`Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`);
        }
        ensureStandalonePluginReady(tmpCloneDir);
        publishStandalonePlugin(tmpCloneDir, targetDir, (commitHash) => {
            updateStandaloneLockEntry(lock, name, cloneUrl, lock[name], commitHash);
            if (commitHash) {
                writeLockFile(lock);
            }
        });
    });
}
/**
 * Update all installed plugins.
 * Continues even if individual plugin updates fail.
 */
export function updateAllPlugins() {
    return listPlugins().map((plugin) => {
        try {
            updatePlugin(plugin.name);
            return { name: plugin.name, success: true };
        }
        catch (err) {
            return {
                name: plugin.name,
                success: false,
                error: getErrorMessage(err),
            };
        }
    });
}
/**
 * List all installed plugins.
 * Reads opencli-plugin.json for description/version when available.
 */
export function listPlugins() {
    if (!fs.existsSync(PLUGINS_DIR))
        return [];
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    const lock = readLockFile();
    const plugins = [];
    for (const entry of entries) {
        // Accept both real directories and symlinks (monorepo sub-plugins)
        const pluginDir = path.join(PLUGINS_DIR, entry.name);
        const isDir = entry.isDirectory() || isSymlinkSync(pluginDir);
        if (!isDir)
            continue;
        const commands = scanPluginCommands(pluginDir);
        const lockEntry = lock[entry.name];
        // Try to read manifest for metadata
        const manifest = readPluginManifest(pluginDir);
        // For monorepo sub-plugins, also check the monorepo root manifest
        let description = manifest?.description;
        let version = manifest?.version;
        if (lockEntry?.source.kind === 'monorepo' && !description) {
            const monoDir = path.join(getMonoreposDir(), lockEntry.source.repoName);
            const monoManifest = readPluginManifest(monoDir);
            const subEntry = monoManifest?.plugins?.[entry.name];
            if (subEntry) {
                description = description ?? subEntry.description;
                version = version ?? subEntry.version;
            }
        }
        const source = resolveStoredPluginSource(lockEntry, pluginDir);
        plugins.push({
            name: entry.name,
            path: pluginDir,
            commands,
            source,
            version: version ?? lockEntry?.commitHash?.slice(0, 7),
            installedAt: lockEntry?.installedAt,
            monorepoName: lockEntry?.source.kind === 'monorepo' ? lockEntry.source.repoName : undefined,
            description,
        });
    }
    return plugins;
}
/** Scan a plugin directory for command files */
function scanPluginCommands(dir) {
    try {
        const files = fs.readdirSync(dir);
        const names = new Set(files
            .filter(f => (f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')) ||
            (f.endsWith('.js') && !f.endsWith('.d.js')))
            .map(f => path.basename(f, path.extname(f))));
        return [...names];
    }
    catch {
        return [];
    }
}
/** Get git remote origin URL */
function getPluginSource(dir) {
    try {
        return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
            cwd: dir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch {
        return undefined;
    }
}
/** Parse a plugin source string into clone URL, repo name, and optional sub-plugin. */
function parseSource(source) {
    if (source.startsWith('file://')) {
        try {
            const localPath = path.resolve(fileURLToPath(source));
            return {
                type: 'local',
                localPath,
                name: path.basename(localPath).replace(/^opencli-plugin-/, ''),
            };
        }
        catch {
            return null;
        }
    }
    if (path.isAbsolute(source)) {
        const localPath = path.resolve(source);
        return {
            type: 'local',
            localPath,
            name: path.basename(localPath).replace(/^opencli-plugin-/, ''),
        };
    }
    // github:user/repo/subplugin  (monorepo specific sub-plugin)
    const githubSubMatch = source.match(/^github:([\w.-]+)\/([\w.-]+)\/([\w.-]+)$/);
    if (githubSubMatch) {
        const [, user, repo, sub] = githubSubMatch;
        const name = repo.replace(/^opencli-plugin-/, '');
        return {
            type: 'git',
            cloneUrl: `https://github.com/${user}/${repo}.git`,
            name,
            subPlugin: sub,
        };
    }
    // github:user/repo
    const githubMatch = source.match(/^github:([\w.-]+)\/([\w.-]+)$/);
    if (githubMatch) {
        const [, user, repo] = githubMatch;
        const name = repo.replace(/^opencli-plugin-/, '');
        return {
            type: 'git',
            cloneUrl: `https://github.com/${user}/${repo}.git`,
            name,
        };
    }
    // https://github.com/user/repo (or .git)
    const urlMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (urlMatch) {
        const [, user, repo] = urlMatch;
        const name = repo.replace(/^opencli-plugin-/, '');
        return {
            type: 'git',
            cloneUrl: `https://github.com/${user}/${repo}.git`,
            name,
        };
    }
    // ── Generic git URL support ─────────────────────────────────────────────
    // ssh://git@host/path/to/repo.git
    const sshUrlMatch = source.match(/^ssh:\/\/[^/]+\/(.*?)(?:\.git)?$/);
    if (sshUrlMatch) {
        const pathPart = sshUrlMatch[1];
        const segments = pathPart.split('/');
        const repoSegment = segments.pop();
        const name = repoSegment.replace(/^opencli-plugin-/, '');
        return { type: 'git', cloneUrl: source, name };
    }
    // git@host:user/repo.git (SCP-style)
    const scpMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
    if (scpMatch) {
        const pathPart = scpMatch[1];
        const segments = pathPart.split('/');
        const repoSegment = segments.pop();
        const name = repoSegment.replace(/^opencli-plugin-/, '');
        return { type: 'git', cloneUrl: source, name };
    }
    // Generic https/http git URL (non-GitHub hosts)
    const genericHttpMatch = source.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
    if (genericHttpMatch) {
        const pathPart = genericHttpMatch[1];
        const segments = pathPart.split('/');
        const repoSegment = segments.pop();
        const name = repoSegment.replace(/^opencli-plugin-/, '');
        // Ensure clone URL ends with .git
        const cloneUrl = source.endsWith('.git') ? source : `${source}.git`;
        return { type: 'git', cloneUrl, name };
    }
    return null;
}
/**
 * Symlink the host opencli package into a plugin's node_modules.
 * This ensures TS plugins resolve '@jackwener/opencli/registry' against
 * the running host installation rather than a stale npm-published version.
 */
function linkHostOpencli(pluginDir) {
    try {
        const hostRoot = resolveHostOpencliRoot();
        const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');
        // Remove existing (npm-installed copy or stale symlink)
        if (fs.existsSync(targetLink)) {
            fs.rmSync(targetLink, { recursive: true, force: true });
        }
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(targetLink), { recursive: true });
        // Use 'junction' on Windows (doesn't require admin privileges),
        // 'dir' symlink on other platforms.
        const linkType = isWindows ? 'junction' : 'dir';
        fs.symlinkSync(hostRoot, targetLink, linkType);
        log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
    }
    catch (err) {
        log.warn(`Failed to link host opencli into plugin: ${getErrorMessage(err)}`);
    }
}
/**
 * Resolve the path to the esbuild CLI executable with fallback strategies.
 */
export function resolveEsbuildBin() {
    const hostRoot = resolveHostOpencliRoot();
    // Strategy 1 (Windows): prefer the .cmd wrapper which is executable via shell
    if (isWindows) {
        const cmdPath = path.join(hostRoot, 'node_modules', '.bin', 'esbuild.cmd');
        if (fs.existsSync(cmdPath)) {
            return cmdPath;
        }
    }
    // Strategy 2: resolve esbuild binary via import.meta.resolve
    // (On Unix, shebang scripts are directly executable; on Windows they are not,
    //  so this strategy is skipped on Windows in favour of the .cmd wrapper above.)
    if (!isWindows) {
        try {
            const pkgUrl = import.meta.resolve('esbuild/package.json');
            if (pkgUrl.startsWith('file://')) {
                const pkgPath = fileURLToPath(pkgUrl);
                const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
                const pkg = JSON.parse(pkgRaw);
                if (pkg.bin && typeof pkg.bin === 'object' && pkg.bin.esbuild) {
                    const binPath = path.resolve(path.dirname(pkgPath), pkg.bin.esbuild);
                    if (fs.existsSync(binPath))
                        return binPath;
                }
                else if (typeof pkg.bin === 'string') {
                    const binPath = path.resolve(path.dirname(pkgPath), pkg.bin);
                    if (fs.existsSync(binPath))
                        return binPath;
                }
            }
        }
        catch {
            // ignore package resolution failures
        }
    }
    // Strategy 3: fallback to node_modules/.bin/esbuild (Unix)
    const binFallback = path.join(hostRoot, 'node_modules', '.bin', 'esbuild');
    if (fs.existsSync(binFallback)) {
        return binFallback;
    }
    // Strategy 4: global esbuild in PATH
    try {
        const lookupCmd = isWindows ? 'where esbuild' : 'which esbuild';
        // `where` on Windows may return multiple lines; take only the first match.
        const globalBin = execSync(lookupCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0].trim();
        if (globalBin && fs.existsSync(globalBin)) {
            return globalBin;
        }
    }
    catch {
        // ignore PATH lookup failures
    }
    return null;
}
function resolveHostOpencliRoot(startFile = fileURLToPath(import.meta.url)) {
    let dir = path.dirname(startFile);
    while (true) {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                if (pkg?.name === '@jackwener/opencli') {
                    return dir;
                }
            }
            catch {
                // Keep walking; a malformed package.json should not hide an ancestor package root.
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return path.resolve(path.dirname(startFile), '..');
}
/**
 * Transpile TS plugin files to JS so they work in production mode.
 * Uses esbuild from the host opencli's node_modules for fast single-file transpilation.
 */
function transpilePluginTs(pluginDir) {
    try {
        const esbuildBin = resolveEsbuildBin();
        if (!esbuildBin) {
            log.warn('esbuild not found. TS plugin files will not be transpiled and may fail to load. ' +
                'Install esbuild (`npm i -g esbuild`) or ensure it is available in the opencli host node_modules.');
            return;
        }
        const files = fs.readdirSync(pluginDir);
        const tsFiles = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'));
        for (const tsFile of tsFiles) {
            const jsFile = tsFile.replace(/\.ts$/, '.js');
            const jsPath = path.join(pluginDir, jsFile);
            // Skip if .js already exists (plugin may ship pre-compiled)
            if (fs.existsSync(jsPath))
                continue;
            try {
                execFileSync(esbuildBin, [tsFile, `--outfile=${jsFile}`, '--format=esm', '--platform=node'], {
                    cwd: pluginDir,
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    ...(isWindows && { shell: true }),
                });
                log.debug(`Transpiled plugin file: ${tsFile} → ${jsFile}`);
            }
            catch (err) {
                log.warn(`Failed to transpile ${tsFile}: ${getErrorMessage(err)}`);
            }
        }
    }
    catch (err) {
        log.warn(`TS transpilation setup failed: ${getErrorMessage(err)}`);
    }
}
export { resolveHostOpencliRoot as _resolveHostOpencliRoot, resolveEsbuildBin as _resolveEsbuildBin, getCommitHash as _getCommitHash, installDependencies as _installDependencies, parseSource as _parseSource, postInstallMonorepoLifecycle as _postInstallMonorepoLifecycle, readLockFile as _readLockFile, readLockFileWithWriter as _readLockFileWithWriter, updateAllPlugins as _updateAllPlugins, validatePluginStructure as _validatePluginStructure, writeLockFile as _writeLockFile, writeLockFileWithFs as _writeLockFileWithFs, isSymlinkSync as _isSymlinkSync, getMonoreposDir as _getMonoreposDir, installLocalPlugin as _installLocalPlugin, isLocalPluginSource as _isLocalPluginSource, moveDir as _moveDir, resolvePluginSource as _resolvePluginSource, resolveStoredPluginSource as _resolveStoredPluginSource, toStoredPluginSource as _toStoredPluginSource, toLocalPluginSource as _toLocalPluginSource, };
