import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import type { Config } from "./types";
import type { StreamChunk } from "./streaming";

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

export function isSmallModel(modelId: string, maxTokens?: number): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('4b') || 
         lower.includes('nemotron') ||
         lower.includes('phi') ||
         lower.includes('gemma') ||
         (maxTokens !== undefined && maxTokens <= 8192);
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
  messages: Array<{ role: string; content?: string }>
): boolean {
  const contextLength = estimateModelContextSize(modelId);
  const formatted = messages.map(m => `${m.role}: ${m.content || ""}`).join("\n");
  const totalTokens = countTokens(formatted, modelId);
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
  
  // Qwen models — user typically runs at 128K (effective range for this hardware)
  if (lowerModelId.includes('qwen')) {
    if (lowerModelId.includes('4b')) {
      if (lowerModelId.includes('3.5') || lowerModelId.includes('35') || lowerModelId.includes('v3.5')) {
        return 128000;
      }
      return 128000;
    }
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
  
  if (lowerModelId.includes('mixtral') || lowerModelId.includes('mistral')) {
    return 32000; // Mixtral/Mistral typically have 32k context
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
  
  // Gemma models
  if (lowerModelId.includes('gemma')) {
    return 8000; // Default Gemma context size
  }
  
  // Default fallback for unknown models
  return 32000;
}

export function effectiveContextSize(modelId: string, maxTokens?: number): number {
  const archSize = estimateModelContextSize(modelId, maxTokens);
  if (maxTokens !== undefined) {
    // Clamp effective context: small output limits mean the model can't
    // effectively use a huge input window. Cap at maxTokens * 4 to keep
    // the input proportional to the generation budget.
    return Math.min(archSize, Math.max(maxTokens * 4, 8192));
  }
  return archSize;
}

/**
 * Get model-specific compaction settings.
 * @param modelId - The model identifier
 * @returns Compaction settings including threshold and summary options
 */
export function getModelCompactionSettings(modelId: string, maxTokens?: number): {
  contextSize: number;
  compactThreshold: number;
  summaryReservedPercent: number;
  keepCount: number;
} {
  const contextSize = effectiveContextSize(modelId, maxTokens);
  const lowerModelId = modelId.toLowerCase();
  
  // Reserve 25% of token window for summary after compaction
  const summaryReservedPercent = 0.25;
  
  // Compact at 60% of effective context for small models, 75% for large
  const small = isSmallModel(modelId, maxTokens);
  const compactThreshold = small
    ? Math.floor(contextSize * 0.60)
    : Math.floor(contextSize * 0.75);
  
  // Determine how many messages to keep based on model type
  let keepCount = 10;
  
  if (small) {
    keepCount = 5;
  } else if (lowerModelId.includes('qwen') && lowerModelId.includes('4b')) {
    keepCount = 15;
  } else if (lowerModelId.includes('nemotron') && lowerModelId.includes('4b')) {
    keepCount = 25;
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
  return new OpenAI({
    apiKey: cfg.apiKey || (isLocalProvider(cfg.baseURL) ? "lm-studio" : ""),
    baseURL: cfg.baseURL,
    timeout: cfg.timeout ?? 60000,
    maxRetries: 0, // we handle retries ourselves for fine-grained control
  });
}

/**
 * Return a human-friendly error message for common HTTP status codes.
 * @param status - HTTP status code.
 * @param attempt - Current retry attempt (1-based).
 * @returns Localised error message.
 */
function errorMessage(status: number, attempt: number): string {
  if (status === 401) return "Authentication failed. Check your DASHSCOPE_API_KEY.";
  if (status === 404) return "Model not found. Try a different model name.";
  if (status === 429) return "Rate limited. Retrying...";
  if (status >= 500) return `Server error. Retrying (attempt ${attempt}/3)...`;
  return `HTTP ${status}`;
}

/**
 * Determine whether a request should be retried.
 * @param status - HTTP status code (may be undefined for network errors).
 * @returns True if the request should be retried.
 */
function shouldRetry(status?: number): boolean {
  if (status === undefined) return true; // network error
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * Send a chat completion request with automatic retries and exponential backoff.
 * @param client - OpenAI-compatible client.
 * @param cfg - Application configuration.
 * @param messages - Conversation history.
 * @param tools - Optional OpenAI-formatted tool definitions.
 * @returns The chat response including usage metadata.
 */
export async function chat(
  client: OpenAI,
  cfg: Config,
  messages: ChatMessage[],
  tools?: any[],
  signal?: AbortSignal
): Promise<ChatResponse> {
  const maxRetries = cfg.retryCount ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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
          max_tokens: cfg.maxTokens ?? 65536,
          tools: tools?.length ? tools : undefined,
          tool_choice: tools?.length ? "auto" as const : undefined,
        },
        { signal }
      );

      const choice = completion.choices[0];
      const msg = choice?.message;

      return {
        message: {
          role: msg?.role || "assistant",
          content: normalizeContent(msg?.content),
          reasoning_content: (msg as any).reasoning_content || undefined,
          tool_calls: msg?.tool_calls?.map((tc) => {
            const func = tc as ChatCompletionMessageFunctionToolCall;
            return {
              id: func.id || `call_${Math.random().toString(36).slice(2, 10)}`,
              type: "function" as const,
              function: {
                name: func.function.name,
                arguments: func.function.arguments,
              },
            };
          }),
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

      if (!shouldRetry(status)) {
        throw new Error(errorMessage(status, attempt));
      }

      const message = errorMessage(status, attempt);
      if (attempt === maxRetries) {
        throw new Error(message);
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw lastError || new Error("Unknown error");
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
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, { usage?: { input_tokens: number; output_tokens: number } }, void> {
  const maxRetries = cfg.retryCount ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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
          max_tokens: cfg.maxTokens ?? 65536,
          tools: tools?.length ? tools : undefined,
          tool_choice: tools?.length ? "auto" as const : undefined,
          stream: true,
        },
        { signal }
      );

      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
      let finishReason: string | undefined;
      let usage: { input_tokens: number; output_tokens: number } | undefined;

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
          console.error("[llm chunk] delta:", JSON.stringify(delta));
        }

        if (!delta) continue;

        // Accumulate tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
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
        const { content, reasoningContent } = extractDeltaText(delta);

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
      }

      return { usage };
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      const status = err?.status || err?.status_code || err?.response?.status;
      lastError = err;

      if (!shouldRetry(status)) {
        throw new Error(errorMessage(status, attempt));
      }

      const message = errorMessage(status, attempt);
      if (attempt === maxRetries) {
        throw new Error(message);
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw lastError || new Error("Unknown error");
}
