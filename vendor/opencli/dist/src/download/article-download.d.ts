/**
 * Article download helper — shared logic for downloading articles as Markdown.
 *
 * Used by: zhihu/download, weixin/download, and future article adapters.
 *
 * Flow: ArticleData → TurndownService → image download → frontmatter → .md file
 */
import TurndownService from 'turndown';
export interface ArticleData {
    title: string;
    author?: string;
    publishTime?: string;
    sourceUrl?: string;
    contentHtml: string;
    /** Pre-extracted code blocks to restore after Markdown conversion */
    codeBlocks?: Array<{
        lang: string;
        code: string;
    }>;
    /** Image URLs found in the article (pre-collected from DOM) */
    imageUrls?: string[];
}
export interface FrontmatterLabels {
    author?: string;
    publishTime?: string;
    sourceUrl?: string;
}
export interface ArticleDownloadOptions {
    output: string;
    downloadImages?: boolean;
    /** Extra headers for image downloads (e.g. { Referer: '...' }) */
    imageHeaders?: Record<string, string>;
    maxTitleLength?: number;
    /** Custom TurndownService configuration callback */
    configureTurndown?: (td: TurndownService) => void;
    /** Custom image extension detector (default: infer from URL extension) */
    detectImageExt?: (url: string) => string;
    /** Custom frontmatter labels (default: Chinese labels) */
    frontmatterLabels?: FrontmatterLabels;
    /**
     * Extra CSS selectors removed from the article before Turndown conversion.
     * Use this to drop site-specific noise the adapter can't always trim upstream
     * (e.g. zhihu 折叠卡, weixin 赞赏栏, wiki infobox).
     */
    cleanSelectors?: string[];
    /**
     * Write the markdown to `process.stdout` instead of a file on disk. Image
     * download and directory creation are skipped — remote image URLs are kept
     * as-is so the output is self-contained when piped.
     */
    stdout?: boolean;
}
export interface ArticleDownloadResult {
    title: string;
    author: string;
    publish_time: string;
    status: string;
    size: string;
    saved: string;
}
/**
 * Download an article to Markdown with optional image localization.
 *
 * Handles the full pipeline:
 * 1. HTML → Markdown (via TurndownService)
 * 2. Code block placeholder restoration
 * 3. Batch image downloading with concurrency + deduplication
 * 4. Image URL replacement in Markdown
 * 5. Frontmatter generation (customizable labels)
 * 6. File write
 */
export declare function downloadArticle(data: ArticleData, options: ArticleDownloadOptions): Promise<ArticleDownloadResult[]>;
