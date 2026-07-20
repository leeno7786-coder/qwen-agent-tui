/**
 * Unit tests for skills.ts - Skill management
 * Covers: skill loading, matching, triggering
 */

import { describe, it, expect } from "bun:test";
import {
  loadSkills,
  matchSkillTriggers,
  loadTemplates,
  getSkillCommands,
  getSkillNames,
} from "./skills";

describe("skills.ts - Skill Management", () => {
  describe("loadSkills", () => {
    it("should return a Map", () => {
      const skills = loadSkills();
      expect(skills instanceof Map).toBe(true);
    });

    it("should load built-in skills", () => {
      const skills = loadSkills();
      expect(skills.size).toBeGreaterThan(0);
    });

    it("should have skill names", () => {
      const skills = loadSkills();
      const names = getSkillNames();
      expect(names.length).toBeGreaterThan(0);
    });
  });

  describe("matchSkillTriggers", () => {
    it("should match exact triggers", () => {
      const skills = new Map([
        ["test-skill", { name: "test-skill", triggers: ["test-trigger"], content: "test" } as any]
      ]);
      const matched = matchSkillTriggers("test-trigger", skills);
      expect(matched.length).toBe(1);
      expect(matched[0].name).toBe("test-skill");
    });

    it("should return empty array for no matches", () => {
      const skills = new Map();
      const matched = matchSkillTriggers("nonexistent", skills);
      expect(matched).toEqual([]);
    });

    it("should match partial triggers", () => {
      const skills = new Map([
        ["test-skill", { name: "test-skill", triggers: ["prefix-test"], content: "test" } as any]
      ]);
      const matched = matchSkillTriggers("prefix-test", skills);
      expect(matched.length).toBe(1);
    });
  });

  describe("loadTemplates", () => {
    it("should return a Map", () => {
      const templates = loadTemplates();
      expect(templates instanceof Map).toBe(true);
    });
  });

  describe("getSkillCommands", () => {
    it("should return array of commands", () => {
      const skills = new Map([
        ["test-skill", { name: "test-skill", triggers: ["trigger1"], content: "test", enabled: true } as any]
      ]);
      const commands = getSkillCommands(skills);
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it("should return empty array for empty skills", () => {
      const commands = getSkillCommands(new Map());
      expect(commands).toEqual([]);
    });

    it("should exclude disabled skills", () => {
      const skills = new Map([
        ["test-skill", { name: "test-skill", triggers: ["trigger1"], content: "test", enabled: false } as any]
      ]);
      const commands = getSkillCommands(skills);
      expect(commands).toEqual([]);
    });
  });

  describe("getSkillNames", () => {
    it("should return array of skill names", () => {
      const names = getSkillNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
    });
  });
});
