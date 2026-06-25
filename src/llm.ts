import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { Config } from "./types";
import type { StreamChunk } from "./streaming";

/**
 * Custom error that preserves the HTTP status code through retry re-throws.
 * The OpenAI SDK's APIError has .status, but when we catch and re-throw
 * a plain Error that info is lost. This keeps it available for callers
 * (e.g. agent.ts can check err.status === 401 for custom messaging).
 */
export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --- Types used internally by llm.ts ---

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

export interface ChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
    reasoning_content?: string;
  };
  usage?: { input_tokens: number; output_tokens: number };
}

export function normalizeContent(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    if (Array.isArray(v)) {
      // OpenAI content parts array: [{ type: "text", text: "..." }, { content: "..." }]
      return v.map((part: any) => {
        if (part === null || part === undefined) return "";
        if (typeof part === "string") return part;
        // Prefer text or content sub-field for content part objects
        if (part.text) return String(part.text);
        if (part.content) return String(part.content);
        return String(part);
      }).join("");
    }
    // Single object: try common text-bearing fields
    if (v.text) return String(v.text);
    if (v.content) return String(v.content);
    return String(v);
  }
  return String(v);
}

export function isLocalProvider(baseURL?: string): boolean {
  if (!baseURL) return false;
  const u = baseURL.toLowerCase();
  return u.includes("localhost") || u.includes("127.0.0.1") || u.includes("lm-studio") || u.includes("ollama");
}

/**
 * Heuristic: model is ≤8B parameters (local coding models).
 * Uses model id and optional explicit config — not maxTokens (that is output budget).
 */
export function isSmallModel(
  modelId: string,
  _maxTokens?: number,
  smallModelMode?: boolean
): boolean {
  if (smallModelMode === true) return true;
  if (smallModelMode === false) return false;

  const lower = modelId.toLowerCase();

  // Explicit parameter counts in id (1b–8b, nano, etc.)
  if (/\b(0\.5|1\.5|1|2|3|4|7|8)[-.]?b\b/.test(lower)) return true;
  if (lower.includes("4b") || lower.includes("nano")) return true;

  // Families commonly run locally at ≤8B
  if (lower.includes("nemotron") && (lower.includes("4b") || lower.includes("nano"))) return true;
  if (lower.includes("phi")) return true;
  if (lower.includes("gemma") && /\b(1|2|4|7|8)[-.]?b\b/.test(lower)) return true;
  if (lower.includes("qwen") && /\b(0\.5|1\.5|1|2|3|4|7|8)[-.]?b\b/.test(lower)) return true;
  if (lower.includes("llama") && /\b(1|3|7|8)[-.]?b\b/.test(lower)) return true;
  if (lower.includes("mistral") && lower.includes("7b")) return true;
  if (lower.includes("deepseek") && (lower.includes("1.5b") || lower.includes("7b"))) return true;

  return false;
}

/**
 * Estimate the context size (in tokens) for a given model based on its name.
 * @param modelId - The model identifier
 * @returns Estimated context size in tokens
 */
let _tkEncoder: any = null;
function getTKEncoder(modelId?: string) {
  if (_tkEncoder) return _tkEncoder;
  try {
    const tk = require("tiktoken");
    // Use encoding_for_model if a model name is provided, otherwise fall back to cl100k_base
    if (modelId) {
      try { _tkEncoder = tk.encoding_for_model(modelId); return _tkEncoder; } catch {}
    }
    _tkEncoder = tk.get_encoding("cl100k_base");
  } catch {
    _tkEncoder = null;
  }
  return _tkEncoder;
}

/**
 * Count tokens in text using tiktoken if available, else rough estimate.
 * Optionally pass modelId for model-specific encoding.
 */
export function countTokens(text: string, modelId?: string): number {
  const enc = getTKEncoder(modelId);
  if (enc) {
    try { return enc.encode(text).length; } catch {}
  }
  return Math.ceil(text.length / 4);
}

/**
 * Check whether a conversation fits within the model's context window.
 * Works with the project's Message type (with optional fields).
 * Equivalent to the LM Studio Python example.
 */
export function doesChatFitInContext(
  modelId: string,
  messages: Array<{ role: string; content?: string; toolCalls?: Array<{ name: string; arguments: string }> }>
): boolean {
  const contextLength = estimateModelContextSize(modelId);
  
  // Count content tokens
  let contentTokens = 0;
  for (const m of messages) {
    contentTokens += countTokens(`${m.role}: ${m.content || ""}`, modelId);
  }
  
  // Account for OpenAI-style framing overhead:
  // - Per message: ~4 tokens for role delimiter and content framing
  // - Per tool call: ~8 tokens for function name + arguments structure + delimiter
  // - Per tool response message: ~4 tokens for tool_call_id + role framing
  // - Baseline conversation overhead: ~2 tokens for BOS/EOS delimiters
  const baselineOverhead = 2;
  let overhead = baselineOverhead;
  
  for (const m of messages) {
    overhead += 4; // per-message framing
    if (m.toolCalls) {
      overhead += m.toolCalls.length * 8; // per-tool-call framing
    }
    if (m.role === 'tool') {
      overhead += 4; // tool response framing
    }
  }
  
  const totalTokens = contentTokens + overhead;
  return totalTokens < contextLength;
}

export function estimateModelContextSize(modelId: string, maxTokens?: number): number {
  const lowerModelId = modelId.toLowerCase();
  
  // Check for explicit context size in model name
  if (lowerModelId.includes('1m') || lowerModelId.includes('1048576')) return 1048576;
  if (lowerModelId.includes('500k')) return 500000;
  if (lowerModelId.includes('400k')) return 400000;
  if (lowerModelId.includes('256k')) return 256000;
  if (lowerModelId.includes('128k')) return 128000;
  if (lowerModelId.includes('100k')) return 100000;
  if (lowerModelId.includes('64k')) return 64000;
  if (lowerModelId.includes('32k')) return 32000;
  if (lowerModelId.includes('16k')) return 16000;
  if (lowerModelId.includes('8k')) return 8000;
  if (lowerModelId.includes('4k')) return 4000;
  
  // Qwen models — local ≤8B stacks often run at 128K+
  if (lowerModelId.includes('qwen')) {
    if (/\b(0\.5|1\.5|1|2|3|4|7|8)[-.]?b\b/.test(lowerModelId)) return 128000;
    if (lowerModelId.includes('128k')) return 128000;
    if (lowerModelId.includes('32k')) return 32000;
    return 32000;
  }
  
  // Nemotron — user typically runs at 400K (model + context fits the device)
  if (lowerModelId.includes('nemotron')) {
    if (lowerModelId.includes('4b')) {
      return 400000;
    }
    return 256000;
  }
  
  // Check for specific model families with known context sizes
  if (lowerModelId.includes('gpt-4')) {
    if (lowerModelId.includes('turbo') || lowerModelId.includes('preview')) {
      return 128000; // GPT-4 Turbo has 128k context
    }
    return 8000; // Regular GPT-4 has 8k context
  }
  
  if (lowerModelId.includes('gpt-3.5')) {
    if (lowerModelId.includes('16k')) return 16000;
    return 4000; // Regular GPT-3.5 has 4k context
  }
  
  if (lowerModelId.includes('claude')) {
    if (lowerModelId.includes('200k')) return 200000;
    return 100000; // Default Claude context size
  }
  
  if (lowerModelId.includes('llama') || lowerModelId.includes('codellama')) {
    if (lowerModelId.includes('32k')) return 32000;
    if (lowerModelId.includes('16k')) return 16000;
    return 4000; // Default Llama context size
  }
  
  if (lowerModelId.includes('mixtral') || lowerModelId.includes('mistral') || lowerModelId.includes('codestral')) {
    if (lowerModelId.includes('small') || lowerModelId.includes('ministral') || lowerModelId.includes('mixtral')) return 32000;
    if (lowerModelId.includes('nemo')) return 128000;
    if (lowerModelId.includes('codestral')) return 256000;
    return 128000; // Mistral Large has 128k context
  }
  
  if (lowerModelId.includes('gemini')) {
    if (lowerModelId.includes('128k')) return 128000;
    return 32000; // Default Gemini context size
  }
  
  // DeepSeek models
  if (lowerModelId.includes('deepseek')) {
    if (lowerModelId.includes('v3') || lowerModelId.includes('coder')) return 128000;
    return 65536;
  }
  
  // Phi models
  if (lowerModelId.includes('phi')) {
    if (lowerModelId.includes('4k')) return 4000;
    return 32000; // Phi-3 and newer support longer context
  }
  
  // Gemma models (2b/8b often run at 128k locally)
  if (lowerModelId.includes('gemma')) {
    if (lowerModelId.includes('128k')) return 128000;
    if (/\b(2|7|8)[-.]?b\b/.test(lowerModelId)) return 128000;
    return 8192;
  }

  // Generic 8b local stacks
  if (/\b8[-.]?b\b/.test(lowerModelId)) return 128000;
  
  // Default fallback for unknown models
  return 32000;
}

export function effectiveContextSize(
  modelId: string,
  maxTokens?: number,
  baseURL?: string,
  runtime?: { contextLength?: number; maxContextLength?: number }
): number {
  if (runtime?.contextLength && runtime.contextLength > 0) {
    return runtime.contextLength;
  }
  if (runtime?.maxContextLength && runtime.maxContextLength > 0) {
    return runtime.maxContextLength;
  }

  const archSize = estimateModelContextSize(modelId, maxTokens);
  if (isLocalProvider(baseURL)) return archSize;
  if (maxTokens !== undefined) {
    return Math.min(archSize, Math.max(maxTokens * 4,  8192));
  }
  return archSize;
}

/**
 * Get model-specific compaction settings.
 * @param modelId - The model identifier
 * @returns Compaction settings including threshold and summary options
 */
export function getModelCompactionSettings(
  modelId: string,
  maxTokens?: number,
  options?: {
    baseURL?: string;
    smallModelMode?: boolean;
    modelParamBillions?: number;
    modelContextLength?: number;
    modelMaxContextLength?: number;
  }
): {
  contextSize: number;
  compactThreshold: number;
  summaryReservedPercent: number;
  keepCount: number;
} {
  const contextSize = effectiveContextSize(modelId, maxTokens, options?.baseURL, {
    contextLength: options?.modelContextLength,
    maxContextLength: options?.modelMaxContextLength,
  });
  const lowerModelId = modelId.toLowerCase();
  
  const summaryReservedPercent = 0.30;
  
  const small =
    options?.smallModelMode === true ||
    (options?.modelParamBillions !== undefined
      ? options.modelParamBillions <= 8
      : isSmallModel(modelId, maxTokens, options?.smallModelMode));
  const compactThreshold = small
    ? Math.floor(contextSize * 0.65)
    : Math.floor(contextSize * 0.80);
  
  // Determine how many messages to keep based on model type
  let keepCount = 12;
  
  if (small) {
    keepCount = 6;
  } else if (lowerModelId.includes('qwen') && lowerModelId.includes('4b')) {
    keepCount = 18;
  } else if (lowerModelId.includes('nemotron') && lowerModelId.includes('4b')) {
    keepCount = 30;
  }
  
  return {
    contextSize,
    compactThreshold,
    summaryReservedPercent,
    keepCount,
  };
}

/**
 * Normalise OpenAI-compatible API errors into human-readable strings.
 */
export function extractDeltaText(delta: any): {
  content: string;
  reasoningContent: string;
} {
  if (!delta) return { content: "", reasoningContent: "" };

  const content =
    normalizeContent(delta.content) ||
    normalizeContent(delta.text) ||
    normalizeContent(delta.response) ||
    normalizeContent(delta.message?.content);

  const reasoningContent =
    normalizeContent(delta.reasoning_content) ||
    normalizeContent(delta.reasoningContent);

  return { content, reasoningContent };
}

/**
 * Create an OpenAI-compatible client configured for Qwen.
 * @param cfg - Application configuration.
 * @returns Configured OpenAI client.
 */
export function createClient(cfg: Config) {
  const isOpenRouter = cfg.baseURL.includes("openrouter.ai");
  return new OpenAI({
    apiKey: cfg.apiKey || (isLocalProvider(cfg.baseURL) ? "lm-studio" : ""),
    baseURL: cfg.baseURL,
    timeout: cfg.timeout ?? 60000,
    maxRetries: 0, // we handle retries ourselves for fine-grained control
    defaultHeaders: isOpenRouter
      ? {
          "HTTP-Referer": "https://github.com/qwen-agent-tui",
          "X-Title": "Qwen Agent TUI",
        }
      : undefined,
  });
}

/**
 * Return a human-friendly error message for common HTTP status codes.
 * @param status - HTTP status code.
 * @param attempt - Current retry attempt (1-based).
 * @returns Localised error message.
 */
function extractApiMessage(err: any): string {
  // OpenAI: { error: { message } }
  if (err?.error?.message) return err.error.message;
  // Mistral: { message } at root level
  if (err?.message && !err.message.startsWith("HTTP ")) return err.message;
  // Provider-specific: error_object, error_detail
  if (err?.error_object?.message) return err.error_object.message;
  if (err?.error_detail) return err.error_detail;
  return "";
}

function errorMessage(
  status: number,
  attempt: number,
  originalErr?: any,
  maxAttempts = 3
): string {
  if (status === 401) {
    const detail = extractApiMessage(originalErr);
    return detail ? `Authentication failed (401): ${detail}` : `Authentication failed (401). Check your API key.`;
  }
  if (status === 404) {
    const detail = extractApiMessage(originalErr);
    return detail ? `Model not found (404): ${detail}` : `Model not found (404). Try a different model name.`;
  }
  if (status === 422) {
    const detail = extractApiMessage(originalErr);
    return `Request rejected (422): ${detail || "Check max_tokens, model name, or message format."}`;
  }
  if (status === 429) {
    const detail = extractApiMessage(originalErr);
    return attempt >= maxAttempts
      ? `Rate limited by provider.${detail ? " " + detail : ""} Wait a minute, then retry with fewer sub-agents.`
      : "Rate limited. Retrying...";
  }
  if (status === 503) {
    return `Provider temporarily unavailable (503). Retrying (attempt ${attempt}/${maxAttempts})...`;
  }
  if (status >= 500) return `Server error. Retrying (attempt ${attempt}/${maxAttempts})...`;
  const apiMsg = extractApiMessage(originalErr);
  if (apiMsg) return `HTTP ${status}: ${apiMsg}`;
  return `HTTP ${status}`;
}

/**
 * Determine whether a request should be retried.
 * @param status - HTTP status code (may be undefined for network errors).
 * @returns True if the request should be retried.
 */
/** Error keywords that indicate a non-retriable request (retrying will fail identically). */
const NON_RETRIABLE_ERRORS = [
  "context_length_exceeded",
  "context too long",
  "maximum context length",
  "content_moderation",
  "content policy",
  "invalid_max_tokens",
  "model_not_found",
  "invalid_model",
  "invalid_api_key",
  "insufficient_quota",
];

function isRetriable(err?: any): boolean {
  if (!err) return true;
  const msg = (err.message || err.code || err.type || "").toLowerCase();
  return !NON_RETRIABLE_ERRORS.some((kw) => msg.includes(kw));
}

function shouldRetry(status?: number, attempt?: number, err?: any): boolean {
  if (!isRetriable(err)) return false;
  if (status === undefined) return true; // network error
  if (status === 429) return true;
  if (status === 503) return true;
  if (status >= 500) return true;
  // Some providers return transient 400s under load — retry once
  if (status === 400 && attempt !== undefined && attempt < 2) return true;
  // Mistral sometimes returns 422 on transient validation errors
  if (status === 422 && attempt !== undefined && attempt < 2) return true;
  return false;
}

/**
 * Cap max output tokens to the model's supported limit.
 * Some providers (Mistral, Gemini) reject requests exceeding their max.
 */
function getMaxOutputTokens(modelId: string, configuredMax?: number): number {
  const lower = modelId.toLowerCase();
  if (lower.includes('mistral') || lower.includes('codestral') || lower.includes('ministral') || lower.includes('mixtral')) {
    return Math.min(configuredMax ?? 8192, 8192);
  }
  if (lower.includes('gemini')) {
    return Math.min(configuredMax ?? 8192, 8192);
  }
  if (lower.includes('gpt-3.5')) {
    return Math.min(configuredMax ?? 4096, 4096);
  }
  return configuredMax ?? 65536;
}

/**
 * Send a chat completion request with automatic retries and exponential backoff.
 * @param client - OpenAI-compatible client.
 * @param cfg - Application configuration.
 * @param messages - Conversation history.
 * @param tools - Optional OpenAI-formatted tool definitions.
 * @returns The chat response including usage metadata.
 */
export interface ChatRequestOptions {
  /** Qwen thinking mode — off for sub-agents (tools may land in reasoning as XML). */
  enableThinking?: boolean;
}

export async function chat(
  client: OpenAI,
  cfg: Config,
  messages: ChatMessage[],
  tools?: any[],
  signal?: AbortSignal,
  options?: ChatRequestOptions
): Promise<ChatResponse> {
  const maxRetries = cfg.retryCount ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isQwen = cfg.model.toLowerCase().includes("qwen");
      const enableThinking =
        options?.enableThinking ?? (isQwen ? true : false);
      const completion = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: messages.map((m) => {
            if (m.role === "tool") {
              return {
                role: "tool" as const,
                content: m.content,
                tool_call_id: m.tool_call_id!,
              };
            }
            if (m.role === "assistant" && m.tool_calls) {
              return {
                role: "assistant" as const,
                content: m.content,
                tool_calls: m.tool_calls,
              };
            }
            return { role: m.role, content: m.content };
          }) as any,
          temperature: cfg.temperature ?? 0.2,
      max_tokens: getMaxOutputTokens(cfg.model, cfg.maxTokens),
      tools: tools?.length ? tools : undefined,
      tool_choice: tools?.length ? "auto" as const : undefined,
      ...(isLocalProvider(cfg.baseURL) && tools?.length ? { parallel_tool_calls: false } : {}),
      ...(enableThinking ? { enable_thinking: true } : {}),
    },
    { signal }
  );

  const choice = completion.choices[0];
  const msg = choice?.message;

      return {
        message: {
          role: msg?.role || "assistant",
          content: normalizeContent(msg?.content),
          reasoning_content:
            (msg as any).reasoning_content ||
            (choice as any).reasoning_content ||
            undefined,
          tool_calls: msg?.tool_calls?.map((tc) => {
            const func = tc as ChatCompletionMessageFunctionToolCall;
               // Validate required fields; generate missing id, skip calls with no name
               if (!func.function?.name) {
                 return null;
               }
               return {
                 id: func.id || `call_${Math.random().toString(36).slice(2, 10)}`,
                 type: "function" as const,
                 function: {
                   name: func.function.name,
                   arguments: func.function.arguments || "{}",
                 },
               };
             }).filter((x): x is NonNullable<typeof x> => x !== null),
           },
           usage: completion.usage
             ? {
               input_tokens: completion.usage.prompt_tokens,
               output_tokens: completion.usage.completion_tokens,
             }
             : undefined,
         };
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      const status = err?.status || err?.status_code || err?.response?.status;
      lastError = err;

      if (!shouldRetry(status, attempt, err)) {
        throw new ApiError(errorMessage(status, attempt, err, maxRetries), status);
      }

      const message = errorMessage(status, attempt, err, maxRetries);
      if (attempt === maxRetries) {
        throw new ApiError(message, status);
      }

      // Exponential backoff with jitter: 1-2s, 2-4s, 4-8s
      const base = Math.pow(2, attempt - 1) * 1000;
      const jitter = Math.random() * base;
      await new Promise((res) => setTimeout(res, base + jitter));
    }
  }

  throw lastError || new ApiError("Unknown error");
}

/**
 * Stream a chat completion, yielding chunks as they arrive.
 * Tool calls are accumulated and yielded once complete.
 */
export async function* streamChat(
  client: OpenAI,
  cfg: Config,
  messages: ChatMessage[],
  tools?: any[],
  signal?: AbortSignal,
  options?: ChatRequestOptions
): AsyncGenerator<StreamChunk, { usage?: { input_tokens: number; output_tokens: number } }, void> {
  const maxRetries = cfg.retryCount ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const isQwen = cfg.model.toLowerCase().includes("qwen");
      const enableThinking =
        options?.enableThinking ?? (isQwen ? true : false);
      const stream = await client.chat.completions.create(
        {
          model: cfg.model,
          messages: messages.map((m) => {
            if (m.role === "tool") {
              return {
                role: "tool" as const,
                content: m.content,
                tool_call_id: m.tool_call_id!,
              };
            }
            if (m.role === "assistant" && m.tool_calls) {
              return {
                role: "assistant" as const,
                content: m.content,
                tool_calls: m.tool_calls,
              };
            }
            return { role: m.role, content: m.content };
          }) as any,
          temperature: cfg.temperature ?? 0.2,
          max_tokens: getMaxOutputTokens(cfg.model, cfg.maxTokens),
          tools: tools?.length ? tools : undefined,
          tool_choice: tools?.length ? "auto" as const : undefined,
          ...(isLocalProvider(cfg.baseURL) && tools?.length ? { parallel_tool_calls: false } : {}),
          stream: true,
          ...(enableThinking ? { enable_thinking: true } : {}),
        },
        { signal }
      );

      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
      let finishReason: string | undefined;
      let usage: { input_tokens: number; output_tokens: number } | undefined;

      let yieldedMeaningfulContent = false;

      for await (const chunk of stream) {
        if (signal?.aborted) break;

        const choice = chunk.choices[0];
        const delta = choice?.delta;
        finishReason = choice?.finish_reason || finishReason;

        // Capture usage from the final chunk if present
        if ((chunk as any).usage) {
          const u = (chunk as any).usage;
          usage = {
            input_tokens: u.prompt_tokens,
            output_tokens: u.completion_tokens,
          };
        }

        // Debug: log first few chunks to diagnose empty responses
        if (process.env.QWEN_DEBUG_LLM) {
          console.error("[QWEN_DEBUG] llm chunk:", JSON.stringify(delta));
        }

        if (!delta) continue;

        // Accumulate tool calls (providers vary: tool_calls can appear on delta OR message)
        const toolCallsAny =
          (delta as any).tool_calls ||
          (choice as any).tool_calls ||
          (choice as any).message?.tool_calls ||
          [];

        if (Array.isArray(toolCallsAny) && toolCallsAny.length > 0) {
          for (const tc of toolCallsAny) {
            const idx = tc.index ?? 0;
            let buf = toolCallBuffers.get(idx);
            if (!buf) {
              const fallbackId = tc.id || `call_${idx}_${Math.random().toString(36).slice(2, 10)}`;
              buf = { id: fallbackId, name: tc.function?.name || "", args: "" };
              toolCallBuffers.set(idx, buf);
            } else if (tc.id && !buf.id) {
              buf.id = tc.id;
            }
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) buf.args += tc.function.arguments;
          }
        }

        // Some local servers use different field names for content
        const { content, reasoningContent: drc } = extractDeltaText(delta);
        // Also check choice-level reasoning_content (some providers put it here instead of delta)
        const reasoningContent = drc ||
          normalizeContent((choice as any).reasoning_content) ||
          normalizeContent((choice as any).reasoning);

        // Build complete tool calls from buffers
        const completeToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        for (const buf of toolCallBuffers.values()) {
          if (buf.id && buf.name) {
            completeToolCalls.push({ id: buf.id, name: buf.name, arguments: buf.args });
          }
        }

        yield {
          content,
          reasoningContent,
          toolCalls: completeToolCalls.length > 0 ? completeToolCalls : undefined,
          finishReason,
        };

        // Track if we yielded any meaningful content (not just empty strings)
        if (content || reasoningContent || completeToolCalls.length > 0) {
          yieldedMeaningfulContent = true;
        }
      }

      // Some servers only provide tool calls at the end and never stream any delta content.
      // If we buffered tool calls but never yielded meaningful content, emit one final chunk
      // so the agent doesn't interpret the response as empty and abort the tool loop.
      if (!yieldedMeaningfulContent) {
        const completeToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        for (const buf of toolCallBuffers.values()) {
          if (buf.id && buf.name) {
            completeToolCalls.push({ id: buf.id, name: buf.name, arguments: buf.args });
          }
        }
        if (completeToolCalls.length > 0) {
          yield {
            content: "",
            reasoningContent: "",
            toolCalls: completeToolCalls,
            finishReason: finishReason || "tool_calls",
          };
        }
      }

      return { usage };
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      const status = err?.status || err?.status_code || err?.response?.status;
      lastError = err;

      if (!shouldRetry(status, attempt, err)) {
        throw new ApiError(errorMessage(status, attempt, err, maxRetries), status);
      }

      const message = errorMessage(status, attempt, err, maxRetries);
      if (attempt === maxRetries) {
        throw new ApiError(message, status);
      }

      // Exponential backoff with jitter: 1-2s, 2-4s, 4-8s
      const base = Math.pow(2, attempt - 1) * 1000;
      const jitter = Math.random() * base;
      await new Promise((res) => setTimeout(res, base + jitter));
    }
  }

  throw lastError || new ApiError("Unknown error");
}
