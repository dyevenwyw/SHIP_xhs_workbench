/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 */
import Table from 'cli-table3';
import yaml from 'js-yaml';
function normalizeRows(data) {
    if (Array.isArray(data))
        return data;
    if (data && typeof data === 'object')
        return [data];
    return [{ value: data }];
}
function resolveColumns(rows, opts) {
    return opts.columns ?? Object.keys(rows[0] ?? {});
}
export function render(data, opts = {}) {
    let fmt = opts.fmt ?? 'table';
    // Non-TTY auto-downgrade only when format was NOT explicitly passed by user.
    if (!opts.fmtExplicit) {
        if (fmt === 'table' && !process.stdout.isTTY)
            fmt = 'yaml';
    }
    if (data === null || data === undefined) {
        console.log(data);
        return;
    }
    switch (fmt) {
        case 'json':
            renderJson(data);
            break;
        case 'plain':
            renderPlain(data);
            break;
        case 'md':
        case 'markdown':
            renderMarkdown(data, opts);
            break;
        case 'csv':
            renderCsv(data, opts);
            break;
        case 'yaml':
        case 'yml':
            renderYaml(data);
            break;
        default:
            renderTable(data, opts);
            break;
    }
}
function renderTable(data, opts) {
    const rows = normalizeRows(data);
    if (!rows.length) {
        console.log('(no data)');
        return;
    }
    const columns = resolveColumns(rows, opts);
    const header = columns.map(c => capitalize(c));
    const table = new Table({
        head: [...header],
        style: { head: [], border: [] },
        wordWrap: true,
        wrapOnWordBoundary: true,
    });
    for (const row of rows) {
        table.push(columns.map(c => {
            const v = row[c];
            return v === null || v === undefined ? '' : String(v);
        }));
    }
    console.log();
    if (opts.title)
        console.log(`  ${opts.title}`);
    console.log(table.toString());
    const footer = [];
    footer.push(`${rows.length} items`);
    if (opts.elapsed !== undefined)
        footer.push(`${opts.elapsed.toFixed(1)}s`);
    if (opts.source)
        footer.push(opts.source);
    if (opts.footerExtra)
        footer.push(opts.footerExtra);
    console.log(footer.join(' · '));
}
function renderJson(data) {
    console.log(JSON.stringify(data, null, 2));
}
function renderPlain(data) {
    const rows = normalizeRows(data);
    if (!rows.length)
        return;
    // Single-row single-field shortcuts for chat-style commands.
    if (rows.length === 1) {
        const row = rows[0];
        const entries = Object.entries(row);
        if (entries.length === 1) {
            const [key, value] = entries[0];
            if (key === 'response' || key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
                console.log(String(value ?? ''));
                return;
            }
        }
    }
    rows.forEach((row, index) => {
        const entries = Object.entries(row).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
        entries.forEach(([key, value]) => {
            console.log(`${key}: ${value}`);
        });
        if (index < rows.length - 1)
            console.log('');
    });
}
function renderMarkdown(data, opts) {
    const rows = normalizeRows(data);
    if (!rows.length)
        return;
    if (rows.length === 1) {
        const entries = Object.entries(rows[0]);
        if (entries.length === 1) {
            const [key, value] = entries[0];
            if (key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
                console.log(String(value ?? ''));
                return;
            }
        }
    }
    const columns = resolveColumns(rows, opts);
    console.log('| ' + columns.join(' | ') + ' |');
    console.log('| ' + columns.map(() => '---').join(' | ') + ' |');
    for (const row of rows) {
        console.log('| ' + columns.map(c => String(row[c] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |');
    }
}
function renderCsv(data, opts) {
    const rows = normalizeRows(data);
    if (!rows.length)
        return;
    const columns = resolveColumns(rows, opts);
    console.log(columns.join(','));
    for (const row of rows) {
        console.log(columns.map(c => {
            const v = String(row[c] ?? '');
            return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')
                ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(','));
    }
}
function renderYaml(data) {
    console.log(yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true }));
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
