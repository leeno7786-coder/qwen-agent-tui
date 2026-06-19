import { describe, expect, it } from "bun:test";
import {
  parseParamBillions,
  parseParamBillionsFromModelId,
  isSmallModelFromConfig,
  modelIdsMatch,
} from "./model-runtime";

describe("parseParamBillions", () => {
  it("parses B and M suffixes", () => {
    expect(parseParamBillions("7B")).toBe(7);
    expect(parseParamBillions("270M")).toBe(0.27);
    expect(parseParamBillions("0.5B")).toBe(0.5);
  });
});

describe("parseParamBillionsFromModelId", () => {
  it("extracts size from common model ids", () => {
    expect(parseParamBillionsFromModelId("qwen3-8b-instruct")).toBe(8);
    expect(parseParamBillionsFromModelId("nvidia/nemotron-3-nano-4b")).toBe(4);
  });
});

describe("isSmallModelFromConfig", () => {
  it("uses runtime param count when present", () => {
    expect(
      isSmallModelFromConfig({
        model: "custom",
        modelParamBillions: 7,
      })
    ).toBe(true);
    expect(
      isSmallModelFromConfig({
        model: "custom",
        modelParamBillions: 70,
      })
    ).toBe(false);
  });
});

describe("modelIdsMatch", () => {
  it("matches path suffixes", () => {
    expect(
      modelIdsMatch(
        "publisher/model-8b",
        "model-8b"
      )
    ).toBe(true);
  });
});
