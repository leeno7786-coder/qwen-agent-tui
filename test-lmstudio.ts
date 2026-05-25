import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:1234/v1",
  apiKey: "lm-studio",
  maxRetries: 0,
});

async function testNonStreaming() {
  console.log("=== NON-STREAMING ===");
  try {
    const completion = await client.chat.completions.create({
      model: "model-identifier",
      messages: [
        { role: "system", content: "Always answer in rhymes." },
        { role: "user", content: "Introduce yourself." },
      ],
      temperature: 0.7,
    });
    console.log("Response:", JSON.stringify(completion.choices[0].message, null, 2));
  } catch (e: any) {
    console.error("Error:", e.message, e.status, e.code);
  }
}

async function testStreaming() {
  console.log("\n=== STREAMING ===");
  try {
    const stream = await client.chat.completions.create({
      model: "model-identifier",
      messages: [
        { role: "system", content: "Always answer in rhymes." },
        { role: "user", content: "Introduce yourself." },
      ],
      temperature: 0.7,
      stream: true,
    });

    let i = 0;
    for await (const chunk of stream) {
      i++;
      const choice = chunk.choices[0];
      console.log(`Chunk ${i}:`, JSON.stringify({
        delta: choice?.delta,
        finish_reason: choice?.finish_reason,
        usage: (chunk as any).usage,
      }));
      if (i > 20) {
        console.log("(stopping after 20 chunks)");
        break;
      }
    }
    console.log(`Total chunks: ${i}`);
  } catch (e: any) {
    console.error("Error:", e.message, e.status, e.code);
  }
}

async function main() {
  await testNonStreaming();
  await testStreaming();
}

main().catch(console.error);
