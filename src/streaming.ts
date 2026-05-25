export interface StreamChunk {
  content: string;
  reasoningContent: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: string;
}
