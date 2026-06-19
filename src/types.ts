/**
 * Application configuration shape.
 */
export interface Config {
  /** Base URL for the LLM API. */
  baseURL: string;
  /** Model name to use for completions. */
  model: string;
  /** API key for authentication. */
  apiKey: string;
  /** Maximum number of tool-call iterations per turn. */
  maxIterations: number;
  /** Working directory for file and shell operations. */
  workspace: string;
  /** Additional absolute paths that tools may access with user permission. */
  allowedPaths?: string[];
  /** Optional custom system prompt. */
  systemPrompt?: string;
  /** Optional model profile name (e.g. "qwen-plus"). */
  profile?: string;
  /** Number of retries on transient failures. */
  retryCount?: number;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** UI theme name. */
  theme?: string;
  /** Optimize for small models (4B or less). */
  smallModelMode?: boolean;
  /** Temperature for completions (small models work better with 0.3-0.7). */
  temperature?: number;
  /** Maximum tokens for completions (small models work better with lower values). */
  maxTokens?: number;
  /** Active context length from runtime (e.g. LM Studio loaded instance). */
  modelContextLength?: number;
  /** Maximum context the model supports (from runtime catalog). */
  modelMaxContextLength?: number;
  /** Parameter count in billions when reported by runtime. */
  modelParamBillions?: number;
  /** How modelContextLength / modelParamBillions were obtained. */
  modelRuntimeSource?: "lmstudio" | "heuristic";
  /** Second model for read-only sub-agents (default: Qwen3 Next 80B on OpenRouter). */
  subAgentModel?: string;
  /** OpenAI-compatible API base URL for sub-agents (default: OpenRouter). */
  subAgentBaseURL?: string;
  /** API key for sub-agent provider (default: OPENROUTER_API_KEY). */
  subAgentApiKey?: string;
  /** Use explore_subagent / dispatch_subagents (default true when sub-agent is configured). */
  subAgentEnabled?: boolean;
  /** Max tool loops for one explore_subagent call (default 12). */
  subAgentMaxIterations?: number;
  /** Max output tokens per sub-agent LLM call (default 4096). */
  subAgentMaxTokens?: number;
  subAgentTemperature?: number;
  /** Max concurrent sub-agent runs (legacy; dispatch runs sequentially). */
  subAgentMaxParallel?: number;
  /** Max agents per dispatch_subagents call on OpenRouter (default 2). */
  subAgentMaxPerDispatch?: number;
  /** Minimum delay (ms) between LLM API calls to avoid rate limiting. 0 = disabled. */
  rateLimitMs?: number;
}

/** Possible states of the agent lifecycle. */
export type AgentState =
  | "idle"
  | "thinking"
  | "executing_tool"
  | "waiting_for_user"
  | "reflecting"
  | "error";

/** A chat message stored in the session. */
export interface Message {
  /** Unique message id. */
  id: string;
  /** Message role. */
  role: "system" | "user" | "assistant" | "tool";
  /** Text content. */
  content: string;
  /** Unix timestamp. */
  timestamp: number;
  /** Tool calls emitted by the assistant. */
  toolCalls?: ToolCall[];
  /** Id of the tool call this message answers. */
  toolCallId?: string;
  /** Reasoning / chain-of-thought content (e.g. from DeepSeek-R1, o1, QwQ). */
  reasoningContent?: string;
}

/** Describes a single tool invocation from the LLM. */
export interface ToolCall {
  /** Tool call id. */
  id: string;
  /** Name of the tool. */
  name: string;
  /** JSON-encoded arguments. */
  arguments: string;
}

/** Result of executing a tool. */
export interface ToolResult {
  /** Linked tool call id. */
  toolCallId: string;
  /** Tool name. */
  name: string;
  /** Raw output string. */
  output: string;
  /** Execution duration in milliseconds. */
  duration: number;
}

/** A user-managed todo item. */
export interface Todo {
  /** Todo id. */
  id: string;
  /** Description text. */
  text: string;
  /** Whether the todo is completed. */
  done: boolean;
  /** Creation timestamp. */
  createdAt: number;
}

/** A skill loaded from SKILL.md, JSON, or the agent skills ecosystem. */
export interface Skill {
  /** Skill name (used as identifier). */
  name: string;
  /** Short description. */
  description: string;
  /** Tool names this skill provides. */
  tools: string[];
  /** Prompt text injected when the skill is active. */
  prompt: string;
  /** Keyword triggers for auto-loading (from SKILL.md triggers or WHEN). */
  triggers?: string[];
  /** Command trigger (e.g., "skill:airunway-aks-setup") */
  command?: string;
  /** Longer description for display in settings */
  longDescription?: string;
  /** Version of the skill */
  version?: string;
  /** Author of the skill */
  author?: string;
  /** Tags/categories for the skill */
  tags?: string[];
  /** Whether the skill is enabled */
  enabled?: boolean;
  /** Welcome message shown when skill is activated */
  welcomeMessage?: string;
  /** Predefined options for user to choose from */
  options?: Array<{ label: string; value: string; description?: string }>;
  /** Source type of this skill */
  source?: "skilli.md" | "json" | "inline";
  /** File path this skill was loaded from */
  sourcePath?: string;
}

/** Skill command for slash command system */
export interface SkillCommand {
  name: string;
  description: string;
  fullDescription: string;
  skillName: string;
}

/**
 * Information about an available model for a runtime provider.
 */
export interface ModelInfo {
  /** Unique model identifier. */
  id: string;
  /** Display name of the model. */
  name: string;
  /** Optional description of the model. */
  description?: string;
  /** Whether this is the default model for the provider. */
  default?: boolean;
  /** Active context length when known (LM Studio loaded config). */
  contextLength?: number;
  /** Max context from model catalog. */
  maxContextLength?: number;
  /** Parameter count in billions. */
  paramBillions?: number;
}

/**
 * A runtime provider (connector) that supplies LLM models.
 */
export interface RuntimeProvider {
  /** Unique provider identifier. */
  id: string;
  /** Display name of the provider. */
  name: string;
  /** Optional base URL for the provider's API. */
  baseURL?: string;
  /** Optional API endpoint path. */
  endpoint?: string;
  /** List of models available from this provider. */
  models: ModelInfo[];
  /** Optional description of the provider. */
  description?: string;
  /** Optional icon or emoji for display. */
  icon?: string;
  /** Whether the provider requires an API key. */
  requiresAuth?: boolean;
  /** Whether this is a local runtime (e.g., LM Studio, Ollama). */
  isLocal?: boolean;
  /** Whether models can be fetched dynamically from the runtime. */
  dynamicModels?: boolean;
  /** Environment variable name for API key (e.g., OPENAI_API_KEY). */
  apiKeyEnvVar?: string;
  /** Optional documentation URL. */
  docsUrl?: string;
}

/**
 * Configuration for a connected provider.
 */
export interface ConnectedProvider {
  /** Provider ID. */
  providerId: string;
  /** Selected model ID. */
  modelId: string;
  /** Base URL (may be customized). */
  baseURL?: string;
  /** API key (if provided). */
  apiKey?: string;
}

/** Persisted session. */
export interface Session {
  /** Session id. */
  id: string;
  /** Messages in the session. */
  messages: Message[];
  /** Todos in the session. */
  todos: Todo[];
  /** Creation timestamp. */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;
}

/** User preferences for skill settings. */
export interface SkillConfig {
  /** Whether to persist skill settings across sessions. */
  enabled?: boolean;
  /** Map of skill name -> enabled state (overrides default). */
  skills?: Record<string, boolean>;
  /** Individual skill configuration options. */
  individualSkills?: Record<
    string,
    {
      /** Skill name to configure. */
      name: string;
      /** Short description of what the skill does. */
      description: string;
      /** Tools this skill uses (for permission management). */
      tools?: string[];
      /** System prompt injected when skill is active. */
      prompt?: string;
      /** Version of the skill configuration. */
      version?: string;
    }
  >;
}
