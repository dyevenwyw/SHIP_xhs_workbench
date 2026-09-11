/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */
import type { IPage } from './types.js';
export declare enum Strategy {
    PUBLIC = "public",
    LOCAL = "local",
    COOKIE = "cookie",
    INTERCEPT = "intercept",
    UI = "ui"
}
export interface Arg {
    name: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    valueRequired?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
}
export type CommandArgs = Record<string, any>;
export type BrowserCommandFunc = (page: IPage, kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
export type NonBrowserCommandFunc = (kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
export type CommandAccess = 'read' | 'write';
export type SiteSessionMode = 'ephemeral' | 'persistent';
export interface AuthStatusMetadata {
    quickCheck?: BrowserCommandFunc;
    refresh?: BrowserCommandFunc;
}
interface BaseCliCommand {
    site: string;
    name: string;
    aliases?: string[];
    description: string;
    access: CommandAccess;
    /** Canonical invocation shown in agent-facing help. Generated when omitted. */
    example?: string;
    domain?: string;
    strategy?: Strategy;
    args: Arg[];
    columns?: string[];
    pipeline?: Record<string, unknown>[];
    /** Origin of this command: 'yaml', 'ts', or plugin name. */
    source?: string;
    footerExtra?: (kwargs: CommandArgs) => string | undefined;
    validateArgs?: (kwargs: CommandArgs) => void;
    /**
     * Control pre-navigation and browser-session requirement.
     *
     * After normalizeCommand() expands strategy, this field carries the
     * resolved runtime intent:
     *
     * - `undefined`: no pre-navigation, browser session decided by pipeline steps
     * - `false`: explicitly skip pre-navigation (adapter handles its own navigation)
     * - `true`: needs authenticated browser context but no specific pre-nav URL
     *   (e.g. INTERCEPT/UI adapters, or COOKIE without domain)
     * - `string`: pre-navigate to this URL before running the adapter
     *   (e.g. `'https://x.com'` for COOKIE strategy with domain)
     *
     * Adapter authors can set this explicitly to override the strategy-based default.
     */
    navigateBefore?: boolean | string;
    /** Site session lifecycle for adapter commands. */
    siteSession?: SiteSessionMode;
    /** Default browser window mode for commands whose UX requires visibility. */
    defaultWindowMode?: 'foreground' | 'background';
    /** Override the default CLI output format when the user does not pass -f/--format. */
    defaultFormat?: 'table' | 'plain' | 'json' | 'yaml' | 'yml' | 'md' | 'markdown' | 'csv';
    /** Optional auth-status metadata attached by shared auth adapters. */
    authStatus?: AuthStatusMetadata;
}
export interface BrowserCliCommand extends BaseCliCommand {
    /** Browser commands receive an IPage. Omitted means true after normalization. */
    browser?: true;
    func?: BrowserCommandFunc;
}
export interface NonBrowserCliCommand extends BaseCliCommand {
    /** Non-browser commands do not receive a page argument. */
    browser: false;
    func?: NonBrowserCommandFunc;
}
export type CliCommand = BrowserCliCommand | NonBrowserCliCommand;
type RawCliCommand = BaseCliCommand & {
    browser?: boolean;
    func?: BrowserCommandFunc | NonBrowserCommandFunc;
};
/** Internal extension for lazy-loaded TS modules (not exposed in public API) */
export type InternalCliCommand = CliCommand & {
    _lazy?: boolean;
    _modulePath?: string;
};
type RequiredCliOptions = {
    site: string;
    name: string;
    access: CommandAccess;
    description?: string;
    args?: Arg[];
};
type BrowserStrategy = Exclude<Strategy, Strategy.PUBLIC | Strategy.LOCAL>;
type BrowserCliOptions = Partial<Omit<BrowserCliCommand, 'args' | 'description' | 'browser' | 'strategy'>> & RequiredCliOptions & ({
    browser: true;
    strategy?: Strategy;
} | {
    browser?: true;
    strategy?: BrowserStrategy;
});
type NonBrowserCliOptions = Partial<Omit<NonBrowserCliCommand, 'args' | 'description'>> & RequiredCliOptions & ({
    browser: false;
} | {
    strategy: Strategy.PUBLIC | Strategy.LOCAL;
    browser?: false;
});
export type CliOptions = BrowserCliOptions | NonBrowserCliOptions;
declare global {
    var __opencli_registry__: Map<string, CliCommand> | undefined;
}
export declare function cli(opts: CliOptions): CliCommand;
export declare function getRegistry(): Map<string, CliCommand>;
export declare function fullName(cmd: Pick<BaseCliCommand, 'site' | 'name'>): string;
export declare function strategyLabel(cmd: CliCommand): string;
export declare function registerCommand(cmd: RawCliCommand): void;
export {};
