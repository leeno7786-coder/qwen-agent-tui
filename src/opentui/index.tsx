/** @jsxImportSource @opentui/react */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { loadConfig } from "../config";
import { App } from "./app";

async function main() {
  const cfg = loadConfig();
  const isLocal = /localhost|127\.0\.0\.1/.test(cfg.baseURL);

  if (!cfg.apiKey && !isLocal) {
    const renderer = await createCliRenderer();
    const { TextRenderable } = await import("@opentui/core");
    renderer.root.add(
      new TextRenderable(renderer, {
        content:
          "Error: No API key configured for remote provider.\n" +
          "Set DASHSCOPE_API_KEY or OPENAI_API_KEY,\n" +
          "or ensure a local runtime (LM Studio) is running at " + cfg.baseURL,
      })
    );
    return;
  }

  const renderer = await createCliRenderer({ useMouse: true });
  createRoot(renderer).render(<App renderer={renderer} />);
}

main().catch(console.error);
