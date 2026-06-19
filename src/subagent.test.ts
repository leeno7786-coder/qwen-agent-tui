import { describe, expect, it } from "bun:test";
import { pickSubAgentModel } from "./model-runtime";
import { subAgentAvailable } from "./tools";
import type { ModelInfo } from "./types";

describe("pickSubAgentModel", () => {
  it("picks smallest loaded model that is not the main model", () => {
    const models: ModelInfo[] = [
      {
        id: "main-8b",
        name: "Main 8B",
        default: true,
        paramBillions: 8,
      },
      {
        id: "qwen3.5:0.8b",
        name: "Qwen 0.8B",
        default: true,
        paramBillions: 0.8,
      },
    ];
    const sub = pickSubAgentModel(models, "main-8b");
    expect(sub?.id).toBe("qwen3.5:0.8b");
  });
});

describe("subAgentAvailable", () => {
  it("is false when local sub model equals main", () => {
    expect(
      subAgentAvailable({
        baseURL: "http://127.0.0.1:1234/v1",
        model: "x",
        subAgentModel: "x",
        apiKey: "",
        maxIterations: 10,
        workspace: ".",
      })
    ).toBe(false);
  });

  it("is true when OpenRouter main uses the same model as sub", () => {
    expect(
      subAgentAvailable({
        baseURL: "https://openrouter.ai/api/v1",
        model: "liquid/lfm-2.5-1.2b-instruct:free",
        subAgentModel: "liquid/lfm-2.5-1.2b-instruct:free",
        subAgentBaseURL: "https://openrouter.ai/api/v1",
        apiKey: "or-key",
        maxIterations: 10,
        workspace: ".",
      })
    ).toBe(true);
  });

  it("is true when distinct sub model configured", () => {
    expect(
      subAgentAvailable({
        baseURL: "http://127.0.0.1:1234/v1",
        model: "main-8b",
        subAgentModel: "qwen3.5:0.8b",
        apiKey: "",
        maxIterations: 10,
        workspace: ".",
      })
    ).toBe(true);
  });
});
