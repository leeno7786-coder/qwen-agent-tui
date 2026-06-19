import { loadConfig } from "../src/config";

// Simulate clean environment
process.env = {};

console.log("Testing API Key Isolation Fix (S-001)");
console.log("=====================================\n");

// Test 1: Mistral with OPENAI_API_KEY set - should NOT use it
process.env.OPENAI_API_KEY = 'sk-openai-key';
const cfg1 = loadConfig({ baseURL: 'https://api.mistral.ai/v1', model: 'test' });
console.log('✓ Test 1 - Mistral with OPENAI_API_KEY:', cfg1.apiKey === '' ? '✅ PASS (apiKey is empty)' : '❌ FAIL (apiKey=' + cfg1.apiKey + ')');

// Test 2: OpenAI with OPENAI_API_KEY set - SHOULD use it
process.env = {};
process.env.OPENAI_API_KEY = 'sk-openai-key';
const cfg2 = loadConfig({ baseURL: 'https://api.openai.com/v1', model: 'test' });
console.log('✓ Test 2 - OpenAI with OPENAI_API_KEY:', cfg2.apiKey === 'sk-openai-key' ? '✅ PASS (apiKey=sk-openai-key)' : '❌ FAIL (apiKey=' + cfg2.apiKey + ')');

// Test 3: Mistral with MISTRAL_API_KEY set - should use it
process.env = {};
process.env.MISTRAL_API_KEY = 'mistral-key';
const cfg3 = loadConfig({ baseURL: 'https://api.mistral.ai/v1', model: 'test' });
console.log('✓ Test 3 - Mistral with MISTRAL_API_KEY:', cfg3.apiKey === 'mistral-key' ? '✅ PASS (apiKey=mistral-key)' : '❌ FAIL (apiKey=' + cfg3.apiKey + ')');

// Test 4: Mistral with explicit apiKey - should prefer explicit
process.env = {};
process.env.MISTRAL_API_KEY = 'env-key';
const cfg4 = loadConfig({ baseURL: 'https://api.mistral.ai/v1', model: 'test', apiKey: 'explicit-key' });
console.log('✓ Test 4 - Mistral with explicit apiKey:', cfg4.apiKey === 'explicit-key' ? '✅ PASS (apiKey=explicit-key)' : '❌ FAIL (apiKey=' + cfg4.apiKey + ')');

// Test 5: Anthropic with OPENAI_API_KEY set - should NOT use it
process.env = {};
process.env.OPENAI_API_KEY = 'sk-openai-key';
const cfg5 = loadConfig({ baseURL: 'https://api.anthropic.com/v1', model: 'test' });
console.log('✓ Test 5 - Anthropic with OPENAI_API_KEY:', cfg5.apiKey === '' ? '✅ PASS (apiKey is empty)' : '❌ FAIL (apiKey=' + cfg5.apiKey + ')');

console.log("\nAll S-001 tests completed!");
