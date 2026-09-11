/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 */
export interface RenderOptions {
    fmt?: string;
    /** True when the user explicitly passed -f on the command line */
    fmtExplicit?: boolean;
    columns?: string[];
    title?: string;
    elapsed?: number;
    source?: string;
    footerExtra?: string;
}
export declare function render(data: unknown, opts?: RenderOptions): void;
