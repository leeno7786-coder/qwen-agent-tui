export type SubAgentLens =
  | "general"
  | "security"
  | "performance"
  | "correctness"
  | "readability"
  | "structure";

export const REVIEW_LENSES: SubAgentLens[] = [
  "security",
  "performance",
  "correctness",
  "readability",
];

export const LENS_GUIDANCE: Record<SubAgentLens, string> = {
  general: "",
  security:
    "Find auth/authz gaps, injection, secrets, unsafe defaults, trust-boundary violations, and data exposure.",
  performance:
    "Find hot paths, redundant I/O, N+1 patterns, unnecessary full-file reads, and algorithmic waste.",
  correctness:
    "Find logic bugs, edge cases, error-handling gaps, race conditions, and broken invariants.",
  readability:
    "Find naming issues, unclear structure, duplication, and maintainability problems worth fixing.",
  structure:
    "Map module boundaries, dependencies, layering violations, and architectural risks.",
};

export function normalizeLens(value: unknown): SubAgentLens {
  const raw = String(value ?? "general")
    .trim()
    .toLowerCase();
  if (raw in LENS_GUIDANCE) return raw as SubAgentLens;
  return "general";
}

export function lensSystemAddendum(lens: SubAgentLens): string {
  if (lens === "general") return "";
  return [
    "",
    `## Lens: ${lens}`,
    LENS_GUIDANCE[lens],
    "",
    "Output format:",
    "- Bullet findings only (no preamble)",
    "- Each bullet: **Severity** (Critical/High/Medium/Low) — `path:line` — specific observation + why it matters",
    "- Include symbol/function names when relevant",
    "- If nothing notable after using tools: say `No findings for ${lens} lens.`",
  ].join("\n");
}
