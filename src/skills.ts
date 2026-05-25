import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import type { Skill, SkillCommand } from "./types";

const SKILL_DIRS = [
  join(process.cwd(), "skills"),
  join(homedir(), ".qwen-agent-tui", "skills"),
  join(homedir(), ".agents", "skills"),
];

const TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
  "templates"
);

// Skill config file path
const SKILL_CONFIG_FILE = join(homedir(), ".qwen-agent-tui", "skill-config.json");

// Ensure skill directories exist
function ensureSkillDirs(): void {
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Ignore errors
      }
    }
  }
}

// Built-in skills ship with the package; resolve relative to this file
// so they are found regardless of where the process is launched from.
const BUILTIN_SKILL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills"
);

export function loadSkills(): Map<string, Skill> {
  ensureSkillDirs();
  
  // Load user preferences from config file (if exists)
  const userPrefs = loadSkillConfig();
  
  const map = new Map<string, Skill>();
  // Built-ins first so local/user skills can override them
  const allDirs = [BUILTIN_SKILL_DIR, ...SKILL_DIRS];
  for (const dir of allDirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const skill: Skill = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        // Use filename as name if name is missing
        if (!skill.name) {
          skill.name = basename(file, ".json");
        }
        // Apply user preference from config (override default enabled value)
        if (userPrefs[skill.name] !== undefined) {
          skill.enabled = userPrefs[skill.name];
        } else if (skill.enabled === undefined) {
          // Default to true if not in config and no explicit setting
          skill.enabled = true;
        }
        map.set(skill.name, skill);
      } catch {}
    }
  }
  return map;
}

export function loadTemplates(): Map<string, Skill> {
  const map = new Map<string, Skill>();
  if (!existsSync(TEMPLATE_DIR)) return map;
  
  for (const file of readdirSync(TEMPLATE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const skill: Skill = JSON.parse(readFileSync(join(TEMPLATE_DIR, file), "utf-8"));
      // Use filename as name if name is missing
      if (!skill.name) {
        skill.name = basename(file, ".json");
      }
      // Templates are always disabled by default
      skill.enabled = false;
      map.set(skill.name, skill);
    } catch {}
  }
  return map;
}

/**
 * Get all skill commands for the slash command system
 */
export function getSkillCommands(skills: Map<string, Skill>): SkillCommand[] {
  const commands: SkillCommand[] = [];
  
  for (const [name, skill] of skills) {
    if (!skill.enabled) continue;
    
    // Use custom command or generate from name
    const commandName = skill.command || `skill:${name}`;
    
    // Truncate description for display
    const shortDesc = skill.description || skill.longDescription || "";
    const displayDesc = shortDesc.length > 80 
      ? shortDesc.slice(0, 77) + "..." 
      : shortDesc;
    
    commands.push({
      name: `/${commandName}`,
      description: displayDesc,
      fullDescription: skill.longDescription || skill.description || "",
      skillName: name,
    });
  }
  
  // Sort alphabetically by command name
  commands.sort((a, b) => a.name.localeCompare(b.name));
  
  return commands;
}

/**
 * Get a specific skill by name
 */
export function getSkill(name: string): Skill | undefined {
  const skills = loadSkills();
  return skills.get(name) || skills.get(name.replace(/^skill:/, ""));
}

/**
 * Save a new skill to the skills directory
 */
export function saveSkill(skill: Skill): string {
  ensureSkillDirs();
  const filename = `${skill.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  const path = join(SKILL_DIRS[0], filename);
  
  // Ensure the skill has required fields
  const fullSkill: Skill = {
    name: skill.name,
    description: skill.description || "",
    prompt: skill.prompt || "",
    tools: skill.tools || [],
    enabled: skill.enabled !== false,
    command: skill.command,
    longDescription: skill.longDescription,
    version: skill.version || "1.0.0",
    author: skill.author || "user",
    tags: skill.tags || [],
  };
  
  writeFileSync(path, JSON.stringify(fullSkill, null, 2), "utf-8");
  return path;
}

/**
 * Delete a skill by name
 */
export function deleteSkill(name: string): boolean {
  const skills = loadSkills();
  const skill = skills.get(name) || skills.get(name.replace(/^skill:/, ""));
  if (!skill) return false;
  
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) continue;
    const filename = `${skill.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    const path = join(dir, filename);
    try {
      const fs = require("fs");
      fs.unlinkSync(path);
      return true;
    } catch {
      // Try next directory
    }
  }
  return false;
}

/**
 * Toggle a skill's enabled state
 */
export function toggleSkill(name: string): boolean {
  const skills = loadSkills();
  const skill = skills.get(name) || skills.get(name.replace(/^skill:/, ""));
  if (!skill) return false;
  
  skill.enabled = !skill.enabled;
  
  for (const dir of SKILL_DIRS) {
    if (!existsSync(dir)) continue;
    const filename = `${skill.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    const path = join(dir, filename);
    try {
      writeFileSync(path, JSON.stringify(skill, null, 2), "utf-8");
      return true;
    } catch {
      // Try next directory
    }
  }
  return false;
}

/**
 * Get all available skill names as an array
 */
export function getSkillNames(): string[] {
  const skills = loadSkills();
  return Array.from(skills.keys());
}

/**
 * Load skill configuration from JSON file (if exists)
 */
function loadSkillConfig(): Record<string, boolean> {
  if (!existsSync(SKILL_CONFIG_FILE)) return {};
  
  try {
    const content = readFileSync(SKILL_CONFIG_FILE, "utf-8");
    // Try to parse as array first (legacy format), then object
    const parsed = JSON.parse(content);
    
    if (Array.isArray(parsed)) {
      // Legacy format: ["skill1", "skill2"]
      return parsed.reduce((acc, skill) => ({ ...acc, [skill]: true }), {});
    } else {
      // Object format: {"skill1": true, "skill2": false}
      return parsed as Record<string, boolean>;
    }
  } catch (e) {
    console.error("Failed to load skill config:", e);
    return {};
  }
}

/**
 * Save skill configuration to JSON file
 */
export function saveSkillConfig(config: Record<string, boolean>): void {
  try {
    writeFileSync(SKILL_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save skill config:", e);
  }
}

/**
 * Get current skill configuration from file
 */
export function getSkillConfig(): Record<string, boolean> {
  return loadSkillConfig();
}
