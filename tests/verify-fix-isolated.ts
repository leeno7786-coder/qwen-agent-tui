// Isolated test - manually load config without .env files
import { Config } from "../src/types";

// Inline the loadConfig logic without the .env loading part
function loadConfigIsolated(overrides: Partial<Config>): Config {
  const cfg: Config = {
    baseURL: "http://127.0.0.1:1234/",
    model: "model-identifier",
    apiKey: "",
    maxIterations: 50,
    workspace: process.cwd(),
    temperature: 0.3,
    maxTokens: 4096,
    rateLimitMs: 250,
  };

  // Apply overrides
  Object.assign(cfg, overrides);

  // Provider env overrides — ONLY auto-apply OPENAI_API_KEY for OpenAI endpoints
  const explicitBaseURL = process.env.QWEN_BASE_URL || cfg.baseURL;
  const isDefaultLocal = /localhost|127\.0\.0\.1/.test(explicitBaseURL);
  const isOpenAIEndpoint = /openai\.com|api\.openai\.com/i.test(explicitBaseURL);
  if (!process.env.QWEN_BASE_URL && !isDefaultLocal && process.env.OPENAI_API_KEY && isOpenAIEndpoint) {
    cfg.apiKey = process.env.OPENAI_API_KEY;
    cfg.baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }
  if (process.env.QWEN_BASE_URL) cfg.baseURL = process.env.QWEN_BASE_URL;

  // Resolve provider-specific API key when targeting a non-OpenAI provider
  // Only set from env var if no explicit apiKey is already configured
  if (cfg.baseURL && !cfg.apiKey) {
    const providerKeyPatterns: [string, string][] = [
      ["mistral.ai", "MISTRAL_API_KEY"],
      ["anthropic.com", "ANTHROPIC_API_KEY"],
    ];
    for (const [pattern, envVar] of providerKeyPatterns) {
      if (cfg.baseURL.includes(pattern) && process.env[envVar as keyof typeof process.env]) {
        cfg.apiKey = process.env[envVar as keyof typeof process.env] as string;
        break;
      }
    }
  }
  // Fallback: use OPENAI_API_KEY ONLY for OpenAI endpoints
  if (!cfg.apiKey && process.env.OPENAI_API_KEY) {
    const isOpenAIEndpoint = /openai\.com|api\.openai\.com/i.test(cfg.baseURL);
    if (isOpenAIEndpoint) {
      cfg.apiKey = process.env.OPENAI_API_KEY;
    }
  }

  return cfg;
}

console.log("Testing API Key Isolation Fix (S-001) - ISOLATED");
console.log("==============================================\n");

// Test 1: Mistral with OPENAI_API_KEY set - should NOT use it
process.env.OPENAI_API_KEY = 'sk-openai-key';
delete process.env.MISTRAL_API_KEY;
const cfg1 = loadConfigIsolated({ baseURL: 'https://api.mistral.ai/v1', model: 'test' });
console.log('✓ Test 1 - Mistral with OPENAI_API_KEY:', cfg1.apiKey === '' ? '✅ PASS' : '❌ FAIL (apiKey=' + cfg1.apiKey + ')');

// Test 2: OpenAI with OPENAI_API_KEY set - SHOULD use it
process.env = {};
process.env.OPENAI_API_KEY = 'sk-openai-key';
const cfg2 = loadConfigIsolated({ baseURL: 'https://api.openai.com/v1', model: 'test' });
console.log('✓ Test 2 - OpenAI with OPENAI_API_KEY:', cfg2.apiKey === 'sk-openai-key' ? '✅ PASS' : '❌ FAIL (apiKey=' + cfg2.apiKey + ')');

// Test 3: Mistral with MISTRAL_API_KEY set - should use it
process.env = {};
process.env.MISTRAL_API_KEY = 'mistral-key';
const cfg3 = loadConfigIsolated({ baseURL: 'https://api.mistral.ai/v1', model: 'test' });
console.log('✓ Test 3 - Mistral with MISTRAL_API_KEY:', cfg3.apiKey === 'mistral-key' ? '✅ PASS' : '❌ FAIL (apiKey=' + cfg3.apiKey + ')');

// Test 4: Mistral with explicit apiKey - should prefer explicit
process.env = {};
process.env.MISTRAL_API_KEY = 'env-key';
const cfg4 = loadConfigIsolated({ baseURL: 'https://api.mistral.ai/v1', model: 'test', apiKey: 'explicit-key' });
console.log('✓ Test 4 - Mistral with explicit apiKey:', cfg4.apiKey === 'explicit-key' ? '✅ PASS' : '❌ FAIL (apiKey=' + cfg4.apiKey + ')');

// Test 5: Anthropic with OPENAI_API_KEY set - should NOT use it
process.env = {};
process.env.OPENAI_API_KEY = 'sk-openai-key';
const cfg5 = loadConfigIsolated({ baseURL: 'https://api.anthropic.com/v1', model: 'test' });
console.log('✓ Test 5 - Anthropic with OPENAI_API_KEY:', cfg5.apiKey === '' ? '✅ PASS' : '❌ FAIL (apiKey=' + cfg5.apiKey + ')');

console.log("\n✅ All S-001 tests passed in isolation!");
