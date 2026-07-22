import { createTwoFilesPatch } from 'diff';
/** Build a unified diff and line-change counts for a file edit. */
export function fileChangeDiff(filepath, oldText, newText) {
    const patch = createTwoFilesPatch(filepath, filepath, oldText, newText, '', '', { context: 3 });
    let added = 0;
    let removed = 0;
    for (const line of patch.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++'))
            added++;
        if (line.startsWith('-') && !line.startsWith('---'))
            removed++;
    }
    return { added, removed, diff: patch.trim() };
}
export function formatLineChangeSummary(added, removed) {
    if (added === 0 && removed === 0)
        return 'No changes';
    if (added > 0 && removed > 0) {
        return `Added ${added} line${added === 1 ? '' : 's'}, removed ${removed} line${removed === 1 ? '' : 's'}`;
    }
    if (added > 0)
        return `Added ${added} line${added === 1 ? '' : 's'}`;
    return `Removed ${removed} line${removed === 1 ? '' : 's'}`;
}
