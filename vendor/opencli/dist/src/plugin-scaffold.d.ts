/**
 * Plugin scaffold: generates a ready-to-develop plugin directory.
 *
 * Usage: opencli plugin create <name> [--dir <path>]
 *
 * Creates:
 *   <name>/
 *     opencli-plugin.json   — manifest with name, version, description
 *     package.json          — ESM package with opencli peer dependency
 *     hello.ts              — sample pipeline command
 *     greet.ts              — sample TS command using func()
 *     README.md             — basic documentation
 */
export interface ScaffoldOptions {
    /** Directory to create the plugin in. Defaults to `./<name>` */
    dir?: string;
    /** Plugin description */
    description?: string;
}
export interface ScaffoldResult {
    name: string;
    dir: string;
    files: string[];
}
/**
 * Create a new plugin scaffold directory.
 */
export declare function createPluginScaffold(name: string, opts?: ScaffoldOptions): ScaffoldResult;
