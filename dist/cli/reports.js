import { loadConfig, validateConfig } from '../config.js';
import { checkRuntimeHealth, fetchLocalModels, RUNTIME_PROVIDERS } from '../providers.js';
import { enrichConfigWithRuntime, isSmallModelFromConfig } from '../model-runtime.js';
import { isLocalProvider } from '../llm.js';
export async function getDoctorReport(cfg) {
    const c = cfg ?? loadConfig();
    const validation = validateConfig(c);
    const runtimeOk = await checkRuntimeHealth(c.baseURL);
    const enriched = await enrichConfigWithRuntime(c);
    return {
        ok: validation.valid && (runtimeOk || !/localhost|127\.0\.0\.1/i.test(c.baseURL)),
        workspace: c.workspace,
        baseURL: c.baseURL,
        model: c.model,
        runtime_reachable: runtimeOk,
        model_context_length: enriched.modelContextLength,
        model_max_context_length: enriched.modelMaxContextLength,
        model_param_billions: enriched.modelParamBillions,
        small_model_mode: isSmallModelFromConfig(enriched),
        warnings: validation.warnings,
        errors: validation.errors,
    };
}
export function formatDoctorReport(report) {
    const lines = [
        `workspace: ${report.workspace}`,
        `base_url: ${report.baseURL}`,
        `model: ${report.model}`,
        `runtime: ${report.runtime_reachable ? 'reachable' : 'unreachable'}`,
    ];
    if (report.model_context_length) {
        lines.push(`context: ${report.model_context_length} tokens (loaded)`);
    }
    if (report.model_max_context_length &&
        report.model_max_context_length !== report.model_context_length) {
        lines.push(`max_context: ${report.model_max_context_length} tokens`);
    }
    if (report.model_param_billions !== undefined) {
        lines.push(`params: ~${report.model_param_billions}B`);
    }
    lines.push(`small_model_mode: ${report.small_model_mode}`);
    for (const w of report.warnings)
        lines.push(`warning: ${w}`);
    for (const e of report.errors)
        lines.push(`error: ${e}`);
    lines.push('', 'CLI: qwen-agent doctor --json');
    return lines.join('\n');
}
export async function getModelsList(baseURL, cfg) {
    const c = cfg ?? loadConfig();
    const url = baseURL || c.baseURL;
    // For local providers, fetch models from the runtime
    if (isLocalProvider(url)) {
        return fetchLocalModels(url);
    }
    // For remote providers, return hardcoded models from the provider config
    // Try to find the provider by baseURL
    for (const provider of RUNTIME_PROVIDERS) {
        if (provider.baseURL && url.includes(provider.baseURL.replace(/\/+$/, ''))) {
            return provider.models || [];
        }
    }
    // If no matching provider found, return empty array
    return [];
}
export function formatModelsList(models) {
    if (models.length === 0) {
        return 'No models returned. For local providers, ensure the runtime is running.\nFor remote providers, check your API key and base URL.\nUse /connect to pick a model.\nCLI: nanogent models';
    }
    const lines = models.map((m) => {
        const loaded = m.default ? ' [loaded]' : '';
        const meta = m.description ? `\n  ${m.description}` : '';
        return `${m.id}${loaded}${meta}`;
    });
    lines.push('', 'Use /connect to switch models.');
    return lines.join('\n');
}
