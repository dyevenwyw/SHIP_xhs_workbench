/**
 * Lightweight manifest-based completion for the fast path.
 *
 * This module MUST NOT import registry, discovery, or any heavy module.
 * It only reads pre-compiled cli-manifest.json files synchronously.
 */
/**
 * Returns true only if ALL manifest files exist and are readable.
 * If any source lacks a manifest (e.g. user adapters without a compiled manifest),
 * the fast path must not be used — otherwise those adapters would silently
 * disappear from completion results.
 */
export declare function hasAllManifests(manifestPaths: string[]): boolean;
/**
 * Lightweight completion that reads directly from manifest JSON files,
 * bypassing full CLI discovery and adapter loading.
 */
export declare function getCompletionsFromManifest(words: string[], cursor: number, manifestPaths: string[]): string[] | null;
/**
 * Print completion script for the given shell. Returns true if handled, false if unknown shell.
 */
export declare function printCompletionScriptFast(shell: string): boolean;
