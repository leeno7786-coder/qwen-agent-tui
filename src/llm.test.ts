import { describe, expect, it } from "bun:test";
import { extractDeltaText } from "./llm";

describe("extractDeltaText", () => {
  it("reads standard OpenAI streaming content", () => {
    expect(extractDeltaText({ content: "hello" })).toEqual({
      content: "hello",
      reasoningContent: "",
    });
  });

  it("reads LM Studio-compatible alternate token fields", () => {
    expect(extractDeltaText({ text: "hello" }).content).toBe("hello");
    expect(extractDeltaText({ response: "world" }).content).toBe("world");
    expect(extractDeltaText({ message: { content: "nested" } }).content).toBe("nested");
  });

  it("normalizes array content parts", () => {
    expect(
      extractDeltaText({
        content: [{ type: "text", text: "hello " }, { content: "world" }],
      }).content
    ).toBe("hello world");
  });

  it("reads reasoning extension fields separately", () => {
    expect(extractDeltaText({ reasoning_content: "thinking" })).toEqual({
      content: "",
      reasoningContent: "thinking",
    });
  });
});
