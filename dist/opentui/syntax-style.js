import { SyntaxStyle } from '@opentui/core';
let cached = null;
export function getSyntaxStyle() {
    if (!cached) {
        cached = SyntaxStyle.create();
    }
    return cached;
}
