import OpenAI from "openai";

const LMSTUDIO_URL = "http://127.0.0.1:1234/v1";

const client = new OpenAI({
  baseURL: LMSTUDIO_URL,
  apiKey: "lm-studio",
  maxRetries: 0,
});

// Exact system prompt the app builds
const systemPrompt =
  `You are a senior software engineer AI assistant. You help users by reading files, running commands, and modifying code.\n\n` +
  `Platform: Windows PowerShell. ` +
  `Do NOT use Unix-only commands such as grep, tail, head, awk, sed, xargs, or find (Unix version). ` +
  `Use Windows/PowerShell equivalents instead: Select-String or findstr instead of grep, ` +
  `Get-Content instead of cat/tail/head, Remove-Item instead of rm, New-Item instead of touch. ` +
  `Common aliases like ls, mkdir, rm, cat, cd work in PowerShell, but grep and tail do NOT exist.\n\n` +
  `Available tools: bash, read_file, write_file, list_dir, git_status, manage_todos\n\n` +
  `You have a todo list. When the user asks for a complex multi-step task, ` +
  `use the \`manage_todos\` tool to break it into small actionable subtasks. ` +
  `Mark todos complete as you finish them. The user can see your todos in the sidebar.\n\n` +
  `When using tools, wait for the tool result before proceeding. ` +
  `Do not assume a tool succeeded — check the result. ` +
  `If a bash command fails, try an alternative approach.`;

async function testStreaming() {
  console.log("=== LM Studio + app payload (streaming) ===");
  try {
    const stream = await client.chat.completions.create({
      model: "model-identifier",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "hello" },
      ],
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
      if (delta?.content) fullContent += delta.content;
      console.log(`Chunk ${i}:`, JSON.stringify({
        content: delta?.content,
        role: delta?.role,
        finish_reason: choice?.finish_reason,
      }));
      if (i > 30) {
        console.log("(stopping after 30 chunks)");
        break;
      }
    }
    console.log(`\nTotal chunks: ${i}`);
    console.log(`Full content length: ${fullContent.length}`);
    console.log(`Full content: ${fullContent.slice(0, 300)}`);
  } catch (e: any) {
    console.error("Error:", e.message, e.status, e.code);
  }
}

async function testNonStreaming() {
  console.log("\n=== LM Studio + app payload (non-streaming) ===");
  try {
    const completion = await client.chat.completions.create({
      model: "model-identifier",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "hello" },
      ],
      temperature: 0.2,
      max_tokens: 2048,
    });
    const msg = completion.choices[0].message;
    console.log("Content length:", (msg.content || "").length);
    console.log("Content:", msg.content?.slice(0, 300));
  } catch (e: any) {
    console.error("Error:", e.message, e.status, e.code);
  }
}

async function testMinimal() {
  console.log("\n=== LM Studio + minimal payload ===");
  try {
    const stream = await client.chat.completions.create({
      model: "model-identifier",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
      temperature: 0.7,
      stream: true,
    });

    let i = 0;
    let fullContent = "";
    for await (const chunk of stream) {
      i++;
      const content = chunk.choices[0]?.delta?.content;
      if (content) fullContent += content;
    }
    console.log(`Chunks: ${i}, Content: ${fullContent.slice(0, 100)}`);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

async function main() {
  await testMinimal();
  await testStreaming();
  await testNonStreaming();
}

main().catch(console.error);
