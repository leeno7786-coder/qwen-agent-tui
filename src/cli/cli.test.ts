import { describe, expect, it } from "bun:test";
import { runCli } from "./index";

describe("cli", () => {
  it("prints root help", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
  });

  it("rejects unknown command", async () => {
    const code = await runCli(["not-a-command"]);
    expect(code).toBe(1);
  });

  it("run --help exits 0", async () => {
    const code = await runCli(["run", "--help"]);
    expect(code).toBe(0);
  });
});
