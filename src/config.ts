import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import type { Config, SkillConfig } from "./types";
import { isSmallModel } from "./llm";

/**
 * Preset model configurations.
 */
export const MODELS: Record<string, { baseURL: string; model: string }> = {
  "qwen3-coder-flash": {
    baseURL: "https://api.openai.com/v1",
    model: "qwen3-coder-flash",
  },
  "qwen-plus": {
    baseURL: "https://api.openai.com/v1",
    model: "qwen-plus",
  },
  "qwen-max": {
    baseURL: "https://api.openai.com/v1",
    model: "qwen-max",
  },
};

function getDefault(): Config {
  return {
    baseURL: "http://127.0.0.1:1234/",
    model: "model-identifier",
    apiKey: "sk-31aa1aa921374a6faeca82c866b2d0d1",
    maxIterations: 50,
    workspace: process.cwd(),
    // Small model defaults
    temperature: 0.3,
    maxTokens: 4096,
    smallModelMode: false,
  };
}

/**
 * Load `.env` files from the current directory and the workspace.
 * @param workspace - Working directory to search for `.env`.
 */
function loadEnv(workspace: string) {
  const candidates = [
    join(process.cwd(), ".env"),
    join(workspace, ".env"),
    join(homedir(), ".qwen-agent-tui", ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      dotenvConfig({ path: resolve(p) });
    }
  }
}

/**
 * Load configuration from files, `.env`, and environment variables.
 * @param path - Optional explicit config file path.
 * @returns Resolved configuration object.
 */
export function loadConfig(path?: string): Config {
  const cfg: Config = { ...getDefault() };

  // Load .env early so process.env is populated before we read it
  loadEnv(cfg.workspace);

  const candidates = [
    path,
    join(process.cwd(), "qwen-agent.json"),
    join(homedir(), ".qwen-agent.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        Object.assign(cfg, JSON.parse(readFileSync(p, "utf-8")));
      } catch {
        /* ignore malformed JSON */
      }
      break;
    }
  }

  // Provider env overrides — ONLY apply if the user hasn't explicitly set a baseURL.
  // This prevents a stale DASHSCOPE_API_KEY from forcing DashScope when you want LM Studio.
  const explicitBaseURL = process.env.QWEN_BASE_URL || cfg.baseURL;
  const isDefaultLocal = /localhost|127\.0\.0\.1/.test(explicitBaseURL);
  if (!isDefaultLocal && process.env.OPENAI_API_KEY) {
    cfg.apiKey = process.env.OPENAI_API_KEY;
    cfg.baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  }
  if (process.env.QWEN_BASE_URL) cfg.baseURL = process.env.QWEN_BASE_URL;
  if (process.env.QWEN_MODEL) {
    const preset = MODELS[process.env.QWEN_MODEL];
    if (preset) {
      cfg.profile = process.env.QWEN_MODEL;
      cfg.model = preset.model;
      cfg.baseURL = preset.baseURL;
    } else {
      cfg.model = process.env.QWEN_MODEL;
    }
  }
  if (process.env.QWEN_MAX_ITERATIONS) {
    const n = parseInt(process.env.QWEN_MAX_ITERATIONS, 10);
    if (!Number.isNaN(n)) cfg.maxIterations = n;
  }
  if (process.env.QWEN_WORKSPACE) cfg.workspace = process.env.QWEN_WORKSPACE;
  if (process.env.QWEN_RETRY_COUNT) {
    const n = parseInt(process.env.QWEN_RETRY_COUNT, 10);
    if (!Number.isNaN(n)) cfg.retryCount = n;
  }
  if (process.env.QWEN_TIMEOUT) {
    const n = parseInt(process.env.QWEN_TIMEOUT, 10);
    if (!Number.isNaN(n)) cfg.timeout = n;
  }
  if (process.env.QWEN_THEME) cfg.theme = process.env.QWEN_THEME;

  // Auto-detect small model mode after loading configuration
  const smallModel = isSmallModel(cfg.model, cfg.maxTokens);
  
  if (smallModel) {
    cfg.smallModelMode = true;
    // Small models work better with higher temperature for creativity
    if (cfg.temperature === undefined) {
      cfg.temperature = 0.5;
    }
    // Smaller context window for faster responses
    if (cfg.maxTokens === undefined) {
      cfg.maxTokens = 2048;
    }
  }

  const validation = validateConfig(cfg);
  if (validation.warnings.length > 0) {
    console.warn("Config warnings:", validation.warnings.join("; "));
  }
  if (validation.errors.length > 0) {
    console.error("Config errors:", validation.errors.join("; "));
  }

  return cfg;
}

/**
 * Validate a configuration object.
 * @param cfg - Configuration to validate.
 * @returns Validation result with warnings and errors.
 */
export function validateConfig(cfg: Config): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const isLocal = /localhost|127\.0\.0\.1/.test(cfg.baseURL);
  if (!isLocal && (!cfg.apiKey || cfg.apiKey.trim() === "")) {
    warnings.push("apiKey is empty — set DASHSCOPE_API_KEY or OPENAI_API_KEY");
  }

  try {
    new URL(cfg.baseURL);
  } catch {
    errors.push(`baseURL is not a valid URL: ${cfg.baseURL}`);
  }

  if (cfg.maxIterations < 1 || cfg.maxIterations > 200) {
    errors.push(
      `maxIterations must be between 1 and 200, got ${cfg.maxIterations}`
    );
  }

  try {
    const stats = statSync(cfg.workspace);
    if (!stats.isDirectory()) {
      errors.push(`workspace is not a directory: ${cfg.workspace}`);
    }
  } catch {
    errors.push(`workspace does not exist: ${cfg.workspace}`);
  }

  if (cfg.retryCount !== undefined) {
    if (cfg.retryCount < 0 || cfg.retryCount > 10) {
      errors.push(
        `retryCount must be between 0 and 10, got ${cfg.retryCount}`
      );
    }
  }

  if (cfg.timeout !== undefined) {
    if (cfg.timeout < 1000 || cfg.timeout > 300000) {
      errors.push(
        `timeout must be between 1 and 300 seconds (1000-300000ms), got ${cfg.timeout}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Ensure the .env file exists in the user's home directory for qwen-agent-tui.
 */
function ensureEnvFile(): string {
  const envDir = join(homedir(), ".qwen-agent-tui");
  const envPath = join(envDir, ".env");
  
  // Create directory if it doesn't exist
  if (!existsSync(envDir)) {
    try {
      mkdirSync(envDir, { recursive: true });
    } catch {
      // Ignore errors
    }
  }
  
  // Create .env file if it doesn't exist
  if (!existsSync(envPath)) {
    try {
      writeFileSync(envPath, "# Qwen Agent TUI Environment Variables\n", "utf-8");
    } catch {
      // Ignore errors
    }
  }
  
  return envPath;
}

/**
 * Save an API key to the environment file.
 * @param envVarName - The environment variable name (e.g., OPENAI_API_KEY)
 * @param apiKey - The API key value
 * @param envPath - Optional path to .env file
 * @returns True if saved successfully
 */
export function saveApiKeyToEnv(
  envVarName: string,
  apiKey: string,
  envPath?: string
): boolean {
  try {
    const targetPath = envPath || ensureEnvFile();
    
    // Read existing content
    let existingContent = "";
    if (existsSync(targetPath)) {
      existingContent = readFileSync(targetPath, "utf-8");
    }
    
    // Check if the variable already exists
    const lines = existingContent.split("\n");
    const varName = `${envVarName}=`;
    const updatedLines = [];
    let found = false;
    
    for (const line of lines) {
      if (line.startsWith(varName) || line.trim().startsWith(varName)) {
        // Update existing line
        updatedLines.push(`${varName}${apiKey}`);
        found = true;
      } else if (line.trim() === "" || line.trim().startsWith("#")) {
        // Keep comments and empty lines
        updatedLines.push(line);
      } else {
        updatedLines.push(line);
      }
    }
    
    // If not found, append to the end
    if (!found) {
      updatedLines.push("");
      updatedLines.push(`# ${new Date().toISOString().slice(0, 10)}`);
      updatedLines.push(`${varName}${apiKey}`);
    }
    
    // Write back
    writeFileSync(targetPath, updatedLines.join("\n"), "utf-8");
    
    // Reload environment variables
    dotenvConfig({ path: resolve(targetPath) });
    
    return true;
  } catch (error) {
    console.error("Error saving API key:", error);
    return false;
  }
}

/**
 * Get an API key from the environment or .env files.
 * @param envVarName - The environment variable name
 * @returns The API key or undefined
 */
export function getApiKey(envVarName: string): string | undefined {
  // Check process.env first
  if (process.env[envVarName]) {
    return process.env[envVarName];
  }
  
  // Check .env files
  const candidates = [
    join(process.cwd(), ".env"),
    join(homedir(), ".qwen-agent-tui", ".env"),
    join(homedir(), ".env"),
  ];
  
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf-8");
        const match = content.match(new RegExp(`^${envVarName}=(.+)$`, "m"));
        if (match) {
          return match[1]?.trim() || undefined;
        }
      } catch {
        // Ignore errors
      }
    }
  }
  
  return undefined;
}

/**
 * Remove an API key from the environment file.
 * @param envVarName - The environment variable name
 * @returns True if removed successfully
 */
export function removeApiKeyFromEnv(envVarName: string): boolean {
  try {
    const envPath = ensureEnvFile();
    
    if (!existsSync(envPath)) {
      return false;
    }
    
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    const updatedLines = [];
    let removed = false;
    
    for (const line of lines) {
      if (line.trim().startsWith(`${envVarName}=`)) {
        // Skip this line
        removed = true;
      } else {
        updatedLines.push(line);
      }
    }
    
    if (removed) {
      writeFileSync(envPath, updatedLines.join("\n"), "utf-8");
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error removing API key:", error);
    return false;
  }
}

/**
 * Ensure the skill config directory exists in user's home directory.
 */
function ensureSkillConfigDir(): string {
  const skillConfigDir = join(homedir(), ".qwen-agent-tui", "skill-config");
  
  // Create directory if it doesn't exist
  if (!existsSync(skillConfigDir)) {
    try {
      mkdirSync(skillConfigDir, { recursive: true });
    } catch {
      // Ignore errors
    }
  }
  
  return skillConfigDir;
}

/**
 * Load skill configuration from a JSON file.
 * @returns Skill configuration object or default empty config
 */
export function loadSkillConfig(): SkillConfig {
  const skillConfigDir = ensureSkillConfigDir();
  const configPath = join(skillConfigDir, "skill-config.json");
  
  if (!existsSync(configPath)) {
    return {};
  }
  
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // Ignore malformed JSON
    return {};
  }
}

/**
 * Save skill configuration to a JSON file.
 * @param config - Skill configuration to save
 * @returns True if saved successfully
 */
export function saveSkillConfig(config: SkillConfig): boolean {
  try {
    const skillConfigDir = ensureSkillConfigDir();
    
    // Ensure directory exists
    if (!existsSync(skillConfigDir)) {
      mkdirSync(skillConfigDir, { recursive: true });
    }
    
    const configPath = join(skillConfigDir, "skill-config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    
    return true;
  } catch (error) {
    console.error("Error saving skill configuration:", error);
    return false;
  }
}

/**
 * Toggle a skill's enabled state and persist to config file.
 * @param name - Skill name to toggle
 * @returns True if toggled successfully
 */
export function toggleSkillInConfig(name: string): boolean {
  try {
    const config = loadSkillConfig();
    
    // If no specific setting for this skill, use the global enabled flag
    if (!config.skills) {
      config.skills = {};
    }
    if (!config.skills[name]) {
      if (config.enabled === undefined) {
        config.enabled = true;
      }
      config.skills[name] = !config.enabled;
    } else {
      config.skills[name] = !config.skills[name];
    }
    
    saveSkillConfig(config);
    return true;
  } catch (error) {
    console.error("Error toggling skill in config:", error);
    return false;
  }
}

/**
 * Get the enabled state of a specific skill from config.
 * @param name - Skill name to check
 * @returns Whether the skill is enabled, or undefined if not configured
 */
export function getSkillEnabledFromConfig(name: string): boolean | undefined {
  const config = loadSkillConfig();
  
  // If there's a specific setting for this skill, use it
  if (config.skills && config.skills[name] !== undefined) {
    return config.skills[name];
  }
  
  // Otherwise, check the global enabled flag
  return config.enabled;
}

/**
 * Get all configured skills from the config file.
 * @returns Map of skill name -> enabled state
 */
export function getAllConfiguredSkills(): Map<string, boolean> {
  const config = loadSkillConfig();
  
  const map = new Map<string, boolean>();
  
  // Add globally enabled/disabled setting if present
  if (config.enabled !== undefined) {
    map.set("*", config.enabled);
  }
  
  // Add individual skill settings
  if (config.skills && typeof config.skills === "object") {
    for (const [name, enabled] of Object.entries(config.skills)) {
      map.set(name, enabled);
    }
  }
  
  return map;
}