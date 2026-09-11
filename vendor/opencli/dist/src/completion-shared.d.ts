/**
 * Shared constants and shell script generators for tab-completion.
 *
 * This module MUST remain lightweight (no registry, no discovery imports).
 * Both completion.ts (full path) and completion-fast.ts (manifest path) import from here.
 */
/**
 * Built-in (non-dynamic) top-level commands.
 */
export declare const BUILTIN_COMMANDS: string[];
export declare function bashCompletionScript(): string;
export declare function zshCompletionScript(): string;
export declare function fishCompletionScript(): string;
