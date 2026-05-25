import OpenAI from "openai";
import { loadConfig } from "./src/config";
import { AgentCore } from "./src/agent";

async function main() {
  const cfg = loadConfig();
  console.log("Config baseURL:", cfg.baseURL);
  console.log("Config model:", cfg.model);
  console.log("Config apiKey:", cfg.apiKey ? "[set]" : "[empty]");

  const agent = new AgentCore(cfg);
  await agent.init();

  // Print what messages look like after init
  console.log("\n=== Messages after init ===");
  for (const m of agent.messages) {
    console.log(`${m.role} (${m.id}): ${m.content.slice(0, 100)}...`);
  }

  // Simulate what toChatMessages produces
  const chatMsgs = (agent as any).toChatMessages();
  console.log("\n=== toChatMessages() ===");
  for (const m of chatMsgs) {
    console.log(JSON.stringify(m).slice(0, 200));
  }

  // Now send the exact same request the app sends
  const client = new OpenAI({
    apiKey: cfg.apiKey || "lm-studio",
    baseURL: cfg.baseURL,
    maxRetries: 0,
  });

  console.log("\n=== STREAMING (app mirror) ===");
  try {
    const stream = await client.chat.completions.create({
      model: cfg.model,
      messages: chatMsgs as any,
      temperature: 0.2,
      max_tokens: 2048,
      stream: true,
    });

    let i = 0;
    let fullContent = "";
    for await (const chunk of stream) {
      i++;
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        fullContent += delta.content;
      }
      if (i <= 5 || delta?.content) {
        console.log(`Chunk ${i}:`, JSON.stringify({
          content: delta?.content,
          role: delta?.role,
          finish_reason: choice?.finish_reason,
        }));
      }
      if (i > 30) {
        console.log("(stopping after 30 chunks)");
        break;
      }
    }
    console.log(`\nTotal chunks: ${i}`);
    console.log(`Full content length: ${fullContent.length}`);
    console.log(`Full content: ${fullContent.slice(0, 300)}...`);
  } catch (e: any) {
    console.error("Error:", e.message, e.status, e.code);
  }
}

main().catch(console.error);
