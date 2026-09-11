import yaml from 'js-yaml';
import { fullName } from './registry.js';
import { formatCommandExample } from './serialization.js';
const COMMON_OPTIONS = [
    {
        flags: '-f, --format <fmt>',
        name: 'format',
        help: 'Output format: table, plain, json, yaml, md, csv',
        default: 'table',
        choices: ['table', 'plain', 'json', 'yaml', 'md', 'csv'],
    },
    {
        flags: '--trace <mode>',
        name: 'trace',
        help: 'Trace capture: off, on, retain-on-failure',
        default: 'off',
        choices: ['off', 'on', 'retain-on-failure'],
    },
    {
        flags: '-v, --verbose',
        name: 'verbose',
        help: 'Debug output',
        default: false,
    },
    {
        flags: '-h, --help',
        name: 'help',
        help: 'display help for command',
    },
];
const BROWSER_COMMON_OPTIONS = [
    {
        flags: '--window <mode>',
        name: 'window',
        help: 'Browser window mode: foreground or background',
        choices: ['foreground', 'background'],
    },
    {
        flags: '--site-session <mode>',
        name: 'site-session',
        help: 'Adapter site session lifecycle: ephemeral or persistent',
        choices: ['ephemeral', 'persistent'],
    },
    {
        flags: '--keep-tab <bool>',
        name: 'keep-tab',
        help: 'Keep the browser tab lease after the command finishes',
        choices: ['true', 'false'],
    },
];
function normalizeStructuredHelpFormat(value) {
    const normalized = value?.toLowerCase();
    if (normalized === 'yaml' || normalized === 'yml')
        return 'yaml';
    if (normalized === 'json')
        return 'json';
    return undefined;
}
export function getRequestedHelpFormat(argv = process.argv) {
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '-f' || token === '--format') {
            return normalizeStructuredHelpFormat(argv[i + 1]);
        }
        if (token.startsWith('--format=')) {
            return normalizeStructuredHelpFormat(token.slice('--format='.length));
        }
        if (token.startsWith('-f') && token.length > 2) {
            return normalizeStructuredHelpFormat(token.slice(2));
        }
    }
    return undefined;
}
export function renderStructuredHelp(data, format) {
    if (format === 'json')
        return `${JSON.stringify(data, null, 2)}\n`;
    return yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true });
}
export function wrapCommaList(items, opts = {}) {
    const width = Math.max(opts.width ?? process.stdout.columns ?? 100, 40);
    const indent = opts.indent ?? '  ';
    const sorted = [...items].sort((a, b) => a.localeCompare(b));
    const lines = [];
    let line = indent;
    sorted.forEach((item, index) => {
        const token = `${item}${index < sorted.length - 1 ? ',' : ''}`;
        const prefix = line === indent ? '' : ' ';
        if (line.length + prefix.length + token.length > width && line.trim()) {
            lines.push(line);
            line = `${indent}${token}`;
        }
        else {
            line += `${prefix}${token}`;
        }
    });
    if (line.trim())
        lines.push(line);
    return lines.join('\n');
}
function isLocalIpDomain(domain) {
    if (domain === '::1' || domain === '[::1]')
        return true;
    const parts = domain.split('.');
    if (parts.length !== 4)
        return false;
    return parts.every(part => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
        && Number(parts[0]) === 127;
}
export function classifyAdapter(domain) {
    if (!domain)
        return 'site';
    if (isLocalIpDomain(domain))
        return 'app';
    return domain.includes('.') ? 'site' : 'app';
}
function formatGroupSection(label, names) {
    if (names.length === 0)
        return [];
    return [
        `${label} (${names.length}):`,
        wrapCommaList(names),
        '',
    ];
}
export function formatRootAdapterHelpText(groups) {
    const total = groups.external.length + groups.apps.length + groups.sites.length;
    if (total === 0)
        return '';
    const lines = [''];
    lines.push(...formatGroupSection('External CLIs', groups.external.map(cli => cli.label)));
    lines.push(...formatGroupSection('App adapters', groups.apps));
    lines.push(...formatGroupSection('Site adapters', groups.sites));
    lines.push("Run 'opencli list' for full command details, or 'opencli <site> --help' to inspect one site.");
    lines.push("Agent tip: use 'opencli <site> --help -f yaml' for all command args/options in one structured response.");
    lines.push('');
    return lines.join('\n');
}
function compactArg(arg) {
    return {
        name: arg.name,
        ...(arg.type && arg.type !== 'string' ? { type: arg.type } : {}),
        ...(arg.positional ? { positional: true } : {}),
        ...(arg.required ? { required: true } : {}),
        ...(arg.valueRequired ? { valueRequired: true } : {}),
        ...(arg.default !== undefined ? { default: arg.default } : {}),
        ...(arg.choices?.length ? { choices: arg.choices } : {}),
        ...(arg.help ? { help: arg.help } : {}),
    };
}
function compactCommonOption(option) {
    return {
        name: option.name,
        flags: option.flags,
        help: option.help,
        ...('default' in option ? { default: option.default } : {}),
        ...('choices' in option ? { choices: option.choices } : {}),
    };
}
function compactCommanderArgument(arg) {
    return {
        name: arg.name(),
        ...(arg.required ? { required: true } : {}),
        ...(arg.variadic ? { variadic: true } : {}),
        ...(arg.description ? { help: arg.description } : {}),
        ...(arg.defaultValue !== undefined ? { default: arg.defaultValue } : {}),
        ...(arg.argChoices?.length ? { choices: [...arg.argChoices] } : {}),
    };
}
function compactCommanderOption(option) {
    if (option.hidden)
        return null;
    return {
        name: option.attributeName(),
        flags: option.flags,
        ...(option.description ? { help: option.description } : {}),
        ...(option.required ? { takes_value: 'required' } : {}),
        ...(option.optional ? { takes_value: 'optional' } : {}),
        ...(option.mandatory ? { required: true } : {}),
        ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}),
        ...(option.argChoices?.length ? { choices: [...option.argChoices] } : {}),
        ...(option.negate ? { negate: true } : {}),
    };
}
function compactCommanderOptions(options) {
    return options
        .map(compactCommanderOption)
        .filter((option) => option !== null);
}
/**
 * Extracts a positional placeholder that should appear immediately after this
 * command's name in user-facing path strings. Reads the leading positional
 * (e.g. `<session>`) from a `.usage()` override; commands without a positional
 * override return `null` so the path stays as-is.
 *
 * Example: `browser` declares `.usage('<session> <command> [options]')`,
 * so `commanderPath(browserClickCmd)` becomes
 * `['opencli', 'browser', '<session>', 'click']`.
 */
export function leadingPositionalFromUsage(command) {
    const usage = command._usage;
    if (!usage)
        return null;
    const match = usage.match(/^\s*(<[^>]+>)/);
    return match ? match[1] : null;
}
function commanderPath(command) {
    const parts = [];
    let current = command;
    while (current) {
        const name = current.name();
        if (name) {
            parts.push(name);
            // If this command declares a leading-positional usage override AND we
            // have already collected a child name below it, the positional must
            // appear between this command and the child (i.e. before the names
            // already collected). parts is in reverse order, so push to the end.
            const positional = leadingPositionalFromUsage(current);
            if (positional && parts.length > 1) {
                // We collected child names first (reverse order). Move them up by one
                // and put the positional at index `parts.length - 2` so reverse()
                // places it between this command and the first child name.
                parts.splice(parts.length - 1, 0, positional);
            }
        }
        current = current.parent;
    }
    return parts.reverse();
}
function commandPathFromRoot(namespaceRoot, command) {
    const rootPath = commanderPath(namespaceRoot);
    const commandPath = commanderPath(command);
    // Strip placeholder positional segments (e.g. `<session>`) from the relative
    // name so agents can still address subcommands by their leaf name. Display
    // paths in `command` / `usage` still include the placeholders.
    return commandPath.slice(rootPath.length).filter(part => !/^<.+>$/.test(part));
}
function collectLeafCommands(command) {
    if (command.commands.length === 0)
        return [command];
    return command.commands.flatMap(child => collectLeafCommands(child));
}
function collectDescendantCommands(command) {
    return command.commands.flatMap(child => [child, ...collectDescendantCommands(child)]);
}
function formatCommanderPositionals(args) {
    return args
        .map(arg => {
        const name = `${arg.name()}${arg.variadic ? '...' : ''}`;
        return arg.required ? `<${name}>` : `[${name}]`;
    })
        .join(' ');
}
function formatCommanderUsage(command, opts = {}) {
    const path = commanderPath(command).join(' ');
    const positionalText = formatCommanderPositionals(command.registeredArguments);
    const hasOptions = compactCommanderOptions(command.options).length > 0
        || (opts.namespaceRoot ? compactCommanderOptions(opts.namespaceRoot.options).length > 0 : false)
        || (opts.globalCommand ? compactCommanderOptions(opts.globalCommand.options).length > 0 : false);
    const optionText = hasOptions ? ' [options]' : '';
    return `${path}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}
function compactCommanderCommand(namespaceRoot, command, opts = {}) {
    const relativePath = commandPathFromRoot(namespaceRoot, command);
    return {
        name: relativePath.join(' '),
        command: commanderPath(command).join(' '),
        usage: formatCommanderUsage(command, { namespaceRoot, globalCommand: opts.globalCommand }),
        description: command.description(),
        ...(command.aliases().length ? { aliases: command.aliases() } : {}),
        positionals: command.registeredArguments.map(compactCommanderArgument),
        command_options: compactCommanderOptions(command.options),
    };
}
export function commanderNamespaceHelpData(namespaceRoot, opts = {}) {
    const leaves = collectLeafCommands(namespaceRoot)
        .filter(command => command !== namespaceRoot)
        .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
    // Respect commander's `.usage()` override (e.g. `<session> <command> [options]`
    // on `browser`); fall back to the generic `<command> [args] [options]` form.
    // Read the private `_usage` field directly because `.usage()` returns the
    // auto-generated form if no override was set.
    const commandPath = commanderPath(namespaceRoot).join(' ');
    const usageOverride = namespaceRoot._usage;
    const usage = usageOverride
        ? `${commandPath} ${usageOverride}`
        : `${commandPath} <command> [args] [options]`;
    return {
        namespace: namespaceRoot.name(),
        command: commandPath,
        usage,
        description: opts.description ?? namespaceRoot.description(),
        command_count: leaves.length,
        commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
        namespace_options: compactCommanderOptions(namespaceRoot.options),
        ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
        structured_help: {
            formats: ['yaml', 'json'],
            usage: `${commandPath} --help -f yaml`,
        },
    };
}
export function commanderCommandHelpData(namespaceRoot, command, opts = {}) {
    return {
        namespace: namespaceRoot.name(),
        ...compactCommanderCommand(namespaceRoot, command, opts),
        namespace_options: compactCommanderOptions(namespaceRoot.options),
        ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
        structured_help: {
            formats: ['yaml', 'json'],
            usage: `${commanderPath(command).join(' ')} --help -f yaml`,
        },
    };
}
export function commanderGroupHelpData(namespaceRoot, groupCommand, opts = {}) {
    const leaves = collectLeafCommands(groupCommand)
        .filter(command => command !== groupCommand)
        .sort((a, b) => commandPathFromRoot(namespaceRoot, a).join(' ').localeCompare(commandPathFromRoot(namespaceRoot, b).join(' ')));
    return {
        namespace: namespaceRoot.name(),
        group: commandPathFromRoot(namespaceRoot, groupCommand).join(' '),
        command: commanderPath(groupCommand).join(' '),
        usage: `${commanderPath(groupCommand).join(' ')} <command> [args] [options]`,
        description: groupCommand.description(),
        command_count: leaves.length,
        commands: leaves.map(command => compactCommanderCommand(namespaceRoot, command, opts)),
        namespace_options: compactCommanderOptions(namespaceRoot.options),
        ...(opts.globalCommand ? { global_options: compactCommanderOptions(opts.globalCommand.options) } : {}),
        structured_help: {
            formats: ['yaml', 'json'],
            usage: `${commanderPath(groupCommand).join(' ')} --help -f yaml`,
        },
    };
}
export function installCommanderNamespaceStructuredHelp(namespaceRoot, opts = {}) {
    installStructuredHelp(namespaceRoot, () => commanderNamespaceHelpData(namespaceRoot, opts));
    for (const command of collectDescendantCommands(namespaceRoot)) {
        if (command.commands.length > 0) {
            installStructuredHelp(command, () => commanderGroupHelpData(namespaceRoot, command, opts));
        }
        else {
            installStructuredHelp(command, () => commanderCommandHelpData(namespaceRoot, command, opts));
        }
    }
}
function positionals(cmd) {
    return cmd.args.filter(arg => arg.positional);
}
function commandOptions(cmd) {
    return cmd.args.filter(arg => !arg.positional);
}
function formatPositionals(args) {
    return args
        .map(arg => arg.required ? `<${arg.name}>` : `[${arg.name}]`)
        .join(' ');
}
function formatCommandOptionTerm(arg) {
    if (arg.required || arg.valueRequired)
        return `--${arg.name} <value>`;
    return `--${arg.name} [value]`;
}
export function formatCommandListTerm(cmd) {
    const positionalText = formatPositionals(positionals(cmd));
    const optionText = commandOptions(cmd).length > 0 ? ' [options]' : '';
    return `${cmd.name}${positionalText ? ` ${positionalText}` : ''}${optionText}`;
}
function formatUsage(cmd) {
    const positionalText = formatPositionals(positionals(cmd));
    return `opencli ${cmd.site} ${cmd.name}${positionalText ? ` ${positionalText}` : ''} [options]`;
}
function compactCommand(cmd) {
    return {
        name: cmd.name,
        command: `opencli ${cmd.site} ${cmd.name}`,
        usage: formatUsage(cmd),
        access: cmd.access,
        description: cmd.description,
        browser: !!cmd.browser,
        ...(cmd.domain ? { domain: cmd.domain } : {}),
        ...(cmd.aliases?.length ? { aliases: cmd.aliases } : {}),
        positionals: positionals(cmd).map(compactArg),
        command_options: commandOptions(cmd).map(compactArg),
        ...(cmd.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
        example: formatCommandExample(cmd),
        ...(cmd.siteSession ? { siteSession: cmd.siteSession } : {}),
        ...(cmd.defaultFormat ? { defaultFormat: cmd.defaultFormat } : {}),
        ...(cmd.columns?.length ? { columns: cmd.columns } : {}),
    };
}
export function rootHelpData(program, groups) {
    const adapterNames = new Set([...groups.external.map(cli => cli.name), ...groups.apps, ...groups.sites]);
    const commands = program.commands
        .filter(command => !adapterNames.has(command.name()))
        .map(command => ({
        name: command.name(),
        description: command.description(),
    }));
    const sortLocale = (a, b) => a.localeCompare(b);
    return {
        name: program.name(),
        description: program.description(),
        commands,
        external_clis: {
            count: groups.external.length,
            clis: groups.external.map(cli => cli.name).sort(sortLocale),
            display: groups.external.map(cli => cli.label).sort(sortLocale),
        },
        app_adapters: {
            count: groups.apps.length,
            apps: [...groups.apps].sort(sortLocale),
        },
        site_adapters: {
            count: groups.sites.length,
            sites: [...groups.sites].sort(sortLocale),
        },
        next: [
            'opencli <site> --help -f yaml',
            'opencli list -f yaml',
            'opencli <site> <command> -f yaml',
        ],
    };
}
export function siteHelpData(site, commands) {
    const unique = [...new Map(commands.map(cmd => [fullName(cmd), cmd])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        site,
        command_count: unique.length,
        commands: unique.map(cmd => compactCommand(cmd)),
        common_options: COMMON_OPTIONS.map(compactCommonOption),
        ...(unique.some(cmd => cmd.browser) ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
        next: [
            `opencli ${site} <command> --help -f yaml`,
            `opencli ${site} <command> -f yaml`,
        ],
    };
}
export function commandHelpData(cmd) {
    return {
        site: cmd.site,
        ...compactCommand(cmd),
        common_options: COMMON_OPTIONS.map(compactCommonOption),
        ...(cmd.browser ? { browser_common_options: BROWSER_COMMON_OPTIONS.map(compactCommonOption) } : {}),
        output_formats: ['table', 'plain', 'yaml', 'json', 'md', 'csv'],
    };
}
function formatRows(rows) {
    if (rows.length === 0)
        return [];
    const width = Math.min(Math.max(...rows.map(([left]) => left.length)), 34);
    return rows.map(([left, right]) => `  ${left.padEnd(width + 2)}${right}`);
}
function formatArgHelp(arg) {
    const parts = [];
    if (arg.help)
        parts.push(arg.help);
    if (arg.default !== undefined)
        parts.push(`default: ${arg.default}`);
    if (arg.choices?.length)
        parts.push(`choices: ${arg.choices.join(', ')}`);
    return parts.join('  ');
}
export function formatCommonOptionsHelpText() {
    const rows = COMMON_OPTIONS.map(option => {
        const details = [option.help];
        if ('default' in option)
            details.push(`default: ${option.default}`);
        if ('choices' in option)
            details.push(`choices: ${option.choices.join(', ')}`);
        return [option.flags, details.join('  ')];
    });
    return ['Common options:', ...formatRows(rows)].join('\n');
}
export function formatBrowserCommonOptionsHelpText() {
    const rows = BROWSER_COMMON_OPTIONS.map(option => {
        const details = [option.help];
        if ('choices' in option)
            details.push(`choices: ${option.choices.join(', ')}`);
        return [option.flags, details.join('  ')];
    });
    return ['Browser common options:', ...formatRows(rows)].join('\n');
}
export function formatSiteHelpText(site, commands) {
    const unique = [...new Map(commands.map(cmd => [fullName(cmd), cmd])).values()]
        .sort((a, b) => a.name.localeCompare(b.name));
    const lines = [
        `Usage: opencli ${site} <command> [args] [options]`,
        '',
        wrapCommaList(unique.map(cmd => cmd.name), { indent: '' }),
        '',
        'Commands:',
        ...formatRows(unique.map(cmd => [formatCommandListTerm(cmd), formatSiteCommandDescription(cmd)])),
        '',
        formatCommonOptionsHelpText(),
        ...(unique.some(cmd => cmd.browser) ? ['', formatBrowserCommonOptionsHelpText()] : []),
        '',
        `Agent tip: use 'opencli ${site} --help -f yaml' to get all command args/options in one structured response.`,
        '',
    ];
    return lines.join('\n');
}
export function formatCommandHelpText(cmd) {
    const lines = [
        `Usage: ${formatUsage(cmd)}`,
        '',
        cmd.description,
        '',
    ];
    const positionalRows = positionals(cmd).map(arg => [
        arg.name,
        formatArgHelp(arg),
    ]);
    if (positionalRows.length) {
        lines.push('Arguments:', ...formatRows(positionalRows), '');
    }
    const optionRows = commandOptions(cmd).map(arg => [
        formatCommandOptionTerm(arg),
        formatArgHelp(arg),
    ]);
    if (optionRows.length) {
        lines.push('Command options:', ...formatRows(optionRows), '');
    }
    lines.push(formatCommonOptionsHelpText(), '');
    if (cmd.browser)
        lines.push(formatBrowserCommonOptionsHelpText(), '');
    const meta = [];
    meta.push(`Access: ${cmd.access}`);
    meta.push(`Browser: ${cmd.browser ? 'yes' : 'no'}`);
    if (cmd.domain)
        meta.push(`Domain: ${cmd.domain}`);
    if (cmd.defaultFormat)
        meta.push(`Default format: ${cmd.defaultFormat}`);
    if (cmd.aliases?.length)
        meta.push(`Aliases: ${cmd.aliases.join(', ')}`);
    lines.push(meta.join(' | '));
    lines.push(`Example: ${formatCommandExample(cmd)}`);
    if (cmd.columns?.length)
        lines.push(`Output columns: ${cmd.columns.join(', ')}`);
    lines.push("Agent tip: use '--help -f yaml' for structured args/options.");
    lines.push('');
    return lines.join('\n');
}
export function installStructuredHelp(command, data, textSuffix) {
    const original = command.helpInformation.bind(command);
    command.helpInformation = ((contextOptions) => {
        const format = getRequestedHelpFormat();
        if (format)
            return renderStructuredHelp(data(), format);
        const suffix = typeof textSuffix === 'function' ? textSuffix() : textSuffix ?? '';
        return original(contextOptions) + suffix;
    });
}
export function formatSiteCommandDescription(cmd) {
    const access = cmd.access === 'write' ? '[write]' : '[read]';
    return `${access} ${cmd.description}`;
}
