import { SyntaxStyle } from '@opentui/core';

let cached: SyntaxStyle | null = null;

export function getSyntaxStyle(): SyntaxStyle {
  if (!cached) {
    cached = SyntaxStyle.create();
  }
  return cached;
}
