function parseJSON(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return undefined;
    }
}
function normalizePath(path) {
    if (!path)
        return '.';
    return String(path).replace(/\\/g, '/');
}
function shellActionLabel() {
    return process.platform === 'win32' ? 'PowerShell' : 'Bash';
}
const ACTION_LABELS = {
    write_file: 'Write',
    edit_file: 'Update',
    edit_file_lines: 'Update',
    read_file: 'Read',
    batch_read_files: 'Read',
    execute_command: shellActionLabel(),
    run_tests: 'Test',
    run_command: 'Run',
    typecheck: 'Typecheck',
    install_dependencies: 'Install',
    list_dir: 'List',
    map_project_tree: 'Tree',
    find_files: 'Find',
    grep_search: 'Search',
    search_and_view: 'Search',
    search_files: 'Search',
    git_commit: 'Commit',
    git_status: 'Git Status',
    git_diff: 'Git Diff',
    manage_todos: 'Todo',
    change_workspace: 'Cd',
    stat_path: 'Stat',
    linear_graphql: 'GraphQL',
};
function actionLabel(toolName, result) {
    if (toolName === 'write_file') {
        if (result?.action === 'update')
            return 'Update';
        if (result?.action === 'write')
            return 'Write';
        if ((result?.removed ?? 0) > 0)
            return 'Update';
    }
    return (ACTION_LABELS[toolName] || toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
}
function targetFromArgs(toolName, args, result) {
    if (toolName === 'execute_command' || toolName === 'run_command') {
        return String((args?.command ?? result?.command ?? '')).trim() || '(command)';
    }
    if (toolName === 'manage_todos') {
        return [args?.action, args?.text || args?.id].filter(Boolean).join(': ') || 'todo';
    }
    if (toolName === 'grep_search' || toolName === 'search_files') {
        const path = normalizePath(args?.path);
        const pattern = String(args?.pattern || args?.query || '');
        return `${path}: "${pattern}"`;
    }
    if (toolName === 'git_commit') {
        return String(args?.message || result?.message || '').slice(0, 120) || 'commit';
    }
    if (toolName === 'batch_read_files' && Array.isArray(args?.paths)) {
        return args.paths.map(normalizePath).join(', ');
    }
    return normalizePath((args?.path || result?.path || args?.command || '.'));
}
function firstOutputLine(data) {
    const stdout = typeof data?.stdout === 'string' ? data.stdout.trim() : '';
    const stderr = typeof data?.stderr === 'string' ? data.stderr.trim() : '';
    const error = typeof data?.error === 'string' ? data.error.trim() : '';
    const combined = stdout || stderr || error;
    if (!combined)
        return data?.ok === false ? 'failed' : '(no output)';
    const line = combined.split('\n').find((l) => l.trim()) || combined;
    return line.length > 140 ? line.slice(0, 139) + '…' : line;
}
function previewLinesFromOutput(data, limit = 8) {
    const stdout = typeof data?.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data?.stderr === 'string' ? data.stderr : '';
    const text = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (!text)
        return undefined;
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length <= 1)
        return undefined;
    return lines.slice(0, limit);
}
function formatLineChangeSummary(added, removed) {
    if (added === 0 && removed === 0)
        return 'no changes';
    const parts = [];
    if (added > 0)
        parts.push(`+${added}`);
    if (removed > 0)
        parts.push(`-${removed}`);
    return parts.join(' ');
}
export function buildSummary(toolName, args, result, ok) {
    if (!ok) {
        return String(result?.error || result?.message || 'failed').slice(0, 160);
    }
    if (typeof result?.added === 'number' || typeof result?.removed === 'number') {
        return formatLineChangeSummary(result.added ?? 0, result.removed ?? 0);
    }
    if (toolName === 'read_file') {
        if (result?.total_lines != null)
            return `${result.total_lines} lines`;
        if (result?.content) {
            const lines = String(result.content).split('\n').length;
            return `${lines} line${lines === 1 ? '' : 's'}`;
        }
    }
    if (toolName === 'grep_search' || toolName === 'search_files') {
        const count = (result?.matches ?? result?.results?.length);
        if (count != null)
            return `${count} match${count === 1 ? '' : 'es'}`;
    }
    if (toolName === 'list_dir' && Array.isArray(result?.entries)) {
        return `${result.entries.length} item${result.entries.length === 1 ? '' : 's'}`;
    }
    if (toolName === 'git_diff' && result?.diff === '') {
        return result?.message || 'clean working tree';
    }
    if (result?.stdout != null || result?.stderr != null || result?.code != null) {
        const rc = (result?.code ?? result?.returncode);
        if (rc != null && rc !== 0)
            return `exit ${rc}`;
        return firstOutputLine(result);
    }
    if (result?.path && toolName === 'write_file') {
        return formatLineChangeSummary(result.added ?? 0, result.removed ?? 0);
    }
    return 'ok';
}
export function buildToolDisplayBlock(toolName, argsRaw, resultRaw, durationMs) {
    const args = parseJSON(argsRaw) ?? {};
    const result = parseJSON(resultRaw);
    const ok = result ? (result.ok !== false && result.success !== false) : true;
    if (result?.subagent) {
        const block = {
            action: 'SubAgent',
            target: String(result.subagent),
            ok,
            summary: result?.toolCalls != null
                ? `${String(result.toolCalls)} tool calls`
                : ok
                    ? 'done'
                    : 'failed',
            durationMs,
        };
        if (result?.output) {
            block.previewLines = String(result.output)
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, 12);
        }
        return block;
    }
    if (toolName.startsWith('sub:')) {
        const model = args?.model ? ` · ${args.model}` : '';
        return {
            action: 'SubAgent',
            target: `${toolName.slice(4)}${model}`,
            ok: true,
            summary: `running ${args?.tool ?? 'tool'}…`,
            durationMs,
        };
    }
    const block = {
        action: actionLabel(toolName, result),
        target: targetFromArgs(toolName, args, result),
        ok,
        summary: buildSummary(toolName, args, result ?? {}, ok),
        durationMs,
    };
    if (typeof result?.diff === 'string' && result.diff.trim()) {
        block.diff = result.diff.trim();
    }
    if (!block.diff &&
        toolName === 'git_diff' &&
        typeof result?.stdout === 'string' &&
        result.stdout.trim()) {
        block.diff = result.stdout.trim();
    }
    if (!block.diff) {
        block.previewLines = previewLinesFromOutput(result ?? {});
    }
    return block;
}
