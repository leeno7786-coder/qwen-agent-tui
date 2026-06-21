import { createClient, chat, streamChat } from "./llm";
import type { ChatMessage } from "./llm";
import { tools, toOpenAI, type ToolExecutionHooks, ToolCacheManager, createToolCacheManager, groupToolsForParallelExecution, canRunInParallel } from "./tools";
import type { SubAgentDispatchProgress } from "./subagent";
import { detectContext } from "./context";
import { loadSkills, matchSkillTriggers, getSkill } from "./skills";
import { buildSystemPrompt } from "./prompt";
import {
  enrichConfigWithRuntime,
  isSmallModelFromConfig,
} from "./model-runtime";
import { loadConfig, applySubAgentDefaults } from "./config";
import type { Config, Message, ToolResult, AgentState, Todo, Skill } from "./types";
import { subAgentAvailable } from "./tools";
import { ContextManager, createContextManager } from "./context/manager";
import { SecurityManager, createSecurityManager } from "./security";

/**
 * Core agent orchestrator: manages conversation state, tool execution,
 * and the agent lifecycle.
 */
export class AgentCore {
  private client: ReturnType<typeof createClient>;
  cfg: Config;
  public messages: Message[] = [];
  public state: AgentState = "idle";
  public todos: Todo[] = [];
  public currentTool?: {
    name: string;
    args: string;
    subAgentProgress?: SubAgentDispatchProgress;
  };
  /** Usage from the most recent assistant response. */
  public lastUsage?: { input_tokens: number; output_tokens: number };
  /** Total accumulated usage across the session. */
  public totalUsage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 0,
    output_tokens: 0,
  };
  /** Called whenever the agent state changes. */
  public onUpdate?: () => void;
  /** Called after a tool finishes executing. */
  public onToolResult?: (r: ToolResult) => void;
  /** Enable streaming mode — assistant content updates in real-time. */
  public streaming = true;
  /** Round counter and maximum rounds before stopping. */
  public roundCounter: number = 0;
  public maxRounds: number = 30;
  /** Whether the current model is a small/quantized model (stored from init). */
  private _smallModel: boolean = false;
  /** Skills currently loaded into the agent context. */
  public activeSkills: Map<string, Skill> = new Map();
  /** Set of skill names previously auto-loaded to avoid re-triggering. */
  private _autoLoadedSkills: Set<string> = new Set();
  /** Tool execution cache manager. */
  public toolCache: ToolCacheManager;
  /** Context window manager. */
  public contextManager: ContextManager;
  /** Security manager for command and file access validation. */
  public securityManager: SecurityManager;


  /**
   * @param cfg - Agent configuration.
   */
  constructor(cfg: Config) {
    this.cfg = cfg;
    this.client = createClient(cfg);
    this.toolCache = createToolCacheManager(cfg, cfg.workspace);
    this.contextManager = createContextManager(cfg, []);
    this.securityManager = createSecurityManager(
      {
        enabled: cfg.securityEnabled,
        validateCommands: cfg.securityValidateCommands,
        validateFileAccess: cfg.securityValidateFileAccess,
        sanitizeOutput: cfg.securitySanitizeOutput,
        maxFileSize: cfg.securityMaxFileSize,
        maxBatchFiles: cfg.securityMaxBatchFiles,
        allowedPaths: cfg.securityAllowedPaths,
        blockedPaths: cfg.securityBlockedPaths,
      },
      cfg.workspace
    );
  }

   /**
   * Reconfigure the agent (refreshes LM Studio model metadata when model/URL changes).
   */
  async reconfigure(newCfg: Partial<Config>) {
    const modelChanged =
      newCfg.model !== undefined || newCfg.baseURL !== undefined;
    const workspaceChanged = newCfg.workspace !== undefined;
    const oldWorkspace = this.cfg.workspace;
    
    this.cfg = { ...this.cfg, ...newCfg };
    applySubAgentDefaults(this.cfg);
    
     // Update cache configuration if relevant options changed
    if (newCfg.toolCacheEnabled !== undefined || 
        newCfg.toolCacheTtlMs !== undefined || 
        newCfg.toolCacheMaxSize !== undefined ||
        workspaceChanged) {
      this.toolCache = createToolCacheManager(this.cfg, this.cfg.workspace);
    }
    
    // Clear cache if workspace changed
    if (workspaceChanged) {
      this.toolCache.clear();
    }
    
    // Update context manager if model changed
    if (modelChanged) {
      this.contextManager.updateModel(this.cfg);
      await this.applyRuntimeProfile();
    } else {
      this.client = createClient(this.cfg);
    }

    // Update security manager if workspace changed
    if (workspaceChanged) {
      this.securityManager.setWorkspace(this.cfg.workspace);
    }

    // Update security config if relevant options changed
    if (newCfg.securityEnabled !== undefined ||
        newCfg.securityValidateCommands !== undefined ||
        newCfg.securityValidateFileAccess !== undefined ||
        newCfg.securitySanitizeOutput !== undefined ||
        newCfg.securityMaxFileSize !== undefined ||
        newCfg.securityMaxBatchFiles !== undefined) {
      this.securityManager.updateConfig({
        enabled: this.cfg.securityEnabled,
        validateCommands: this.cfg.securityValidateCommands,
        validateFileAccess: this.cfg.securityValidateFileAccess,
        sanitizeOutput: this.cfg.securitySanitizeOutput,
        maxFileSize: this.cfg.securityMaxFileSize,
        maxBatchFiles: this.cfg.securityMaxBatchFiles,
        allowedPaths: this.cfg.securityAllowedPaths,
        blockedPaths: this.cfg.securityBlockedPaths,
      });
    }
  }

  /**
   * Query LM Studio (or other local runtime) for loaded context and parameter count.
   */
  async applyRuntimeProfile() {
    this.cfg = await enrichConfigWithRuntime(this.cfg);
    this._smallModel = isSmallModelFromConfig(this.cfg);
    this.client = createClient(this.cfg);
  }

   /**
   * Reload config from disk and refresh LM Studio model metadata.
   * Keeps the current in-session workspace (e.g. after /cd).
   */
  async reloadFromDisk() {
    const fresh = loadConfig();
    const workspace = this.cfg.workspace;
    this.cfg = {
      ...this.cfg,
      baseURL: fresh.baseURL,
      model: fresh.model,
      apiKey: fresh.apiKey,
      maxIterations: fresh.maxIterations,
      maxTokens: fresh.maxTokens,
      temperature: fresh.temperature,
      smallModelMode: fresh.smallModelMode,
      subAgentModel: fresh.subAgentModel,
      subAgentBaseURL: fresh.subAgentBaseURL,
      subAgentApiKey: fresh.subAgentApiKey,
      subAgentEnabled: fresh.subAgentEnabled,
      toolCacheEnabled: fresh.toolCacheEnabled,
      toolCacheTtlMs: fresh.toolCacheTtlMs,
      toolCacheMaxSize: fresh.toolCacheMaxSize,
      workspace,
    };
    applySubAgentDefaults(this.cfg);
    
    // Recreate cache manager with new config
    this.toolCache = createToolCacheManager(this.cfg);
    
    await this.applyRuntimeProfile();
  }

  /**
   * Initialise the agent: detect workspace context, load skills,
   * and push the system message.
   */
  async init() {
    await this.applyRuntimeProfile();

    const ctx = detectContext(this.cfg.workspace);
    const allSkills = loadSkills();

    // Populate activeSkills with enabled skills (always-active from config)
    for (const [name, skill] of allSkills) {
      if (skill.enabled === true || this.cfg.systemPrompt?.includes(`skill:${name}`)) {
        this.activeSkills.set(name, skill);
      }
    }

    const skillInfos = allSkills.size > 0
      ? Array.from(allSkills.values()).map(s => ({ name: s.name, desc: (s.description || "").slice(0, 120) }))
      : undefined;

    let system = buildSystemPrompt(this.cfg, {
      workspace: this.cfg.workspace,
      branch: ctx.isGit ? ctx.branch : undefined,
      skillNames: allSkills.size > 0 ? Array.from(allSkills.keys()) : undefined,
      skillInfos,
      allowedPaths: this.cfg.allowedPaths,
    });
    if (this.cfg.modelContextLength) {
      const ctxK = Math.round(this.cfg.modelContextLength / 1000);
      const param =
        this.cfg.modelParamBillions !== undefined
          ? ` · ~${this.cfg.modelParamBillions}B params`
          : "";
      system += `\n\n## Runtime\n${ctxK}k context loaded${param}.`;
    }
    if (subAgentAvailable(this.cfg)) {
      system += `\nSub-agents: OpenRouter \`${this.cfg.subAgentModel}\` — dispatch_subagents (you set prompts, sequential) or explore_subagent (one task).`;
    }
    this.messages = [
      { id: "system-base", role: "system", content: system, timestamp: now() },
    ];
    this.syncTodoMessage();
    this._syncSkillMessages();

    // Debug: log model detection info
    if (process.env.QWEN_DEBUG_LLM) {
      console.error("[QWEN_DEBUG] agent init:", {
        model: this.cfg.model,
        smallModelMode: this.cfg.smallModelMode,
        modelParamBillions: this.cfg.modelParamBillions,
        _smallModel: this._smallModel,
        promptPreview: system.substring(0, 100) + "...",
      });
    }
  }

  /**
   * Process a user message, optionally executing tools in a loop.
   * @param userText - Raw user input.
   */
  async run(userText: string, signal?: AbortSignal) {
    this.setState("thinking");

    // Increment round counter and check if max rounds reached
    this.roundCounter++;
    if (this.roundCounter > this.maxRounds) {
      this.addAssistantMessage(this._smallModel
        ? `Agent reached max rounds (${this.maxRounds}). Stopping.`
        : `⚠️ Agent has reached the maximum number of rounds (${this.maxRounds}). Stopping to prevent infinite loops.`);
      this.setState("idle");
      return;
    }

    // Auto-load skills matching user input triggers
    if (!userText.trim().startsWith("/")) {
      const autoLoaded = this.autoLoadMatchingSkills(userText);
      if (autoLoaded.length > 0) {
        const names = autoLoaded.map(s => s.name).join(", ");
        this.addAssistantMessage(`Auto-loaded skills: ${names} — these are now active in context.`);
      }
    }

    // Guided skill creation
    if (userText.trim().startsWith("/create-skill")) {
      this.addAssistantMessage(
        this._smallModel
          ? "Let's create a custom skill. Provide:\n1. What the skill does\n2. Slash command (e.g. /py-format)\n3. Which tools it needs\n4. Description and prompt"
          : "🔧 Let's create a custom skill together.\n" +
        "1. What should the skill do? (e.g., 'format Python code', 'review PRs')\n" +
        "2. What slash command should users type? (e.g., `/py-format`, `/pr-review`)\n" +
        "3. Which tools does it need? (e.g., `write_file`, `bash`, `grep_search`)\n" +
        "4. Give me a short description and example prompt.\n" +
        "I'll generate a complete, ready-to-use `.json` skill file for you."
      );
      return;
    }

    // Handle skill load commands (/skill:name, /skill-load name)
    const trimmed = userText.trim();
    if (trimmed.startsWith("/skill:")) {
      const skillName = trimmed.replace(/^\/skill:/, "").split(/\s+/)[0];
      const skill = getSkill(skillName);
      if (skill && this.loadSkill(skill)) {
        this.addAssistantMessage(`**Skill Loaded: ${skill.name}**\n\n${skill.description}\n\nHow would you like to use this skill?`);
      } else if (skill) {
        this.addAssistantMessage(`Skill "${skillName}" is already loaded.`);
      } else {
        this.addAssistantMessage(`Skill "${skillName}" not found. Available skills: ${Array.from(loadSkills().keys()).join(", ")}`);
      }
      return;
    }

    if (trimmed.startsWith("/skill-load ")) {
      const skillName = trimmed.replace("/skill-load ", "").trim().split(/\s+/)[0];
      const skill = getSkill(skillName);
      if (skill && this.loadSkill(skill)) {
        this.addAssistantMessage(`**Skill Loaded: ${skill.name}**\n\n${skill.description}\n\nHow would you like to use this skill?`);
      } else if (skill) {
        this.addAssistantMessage(`Skill "${skillName}" is already loaded.`);
      } else {
        this.addAssistantMessage(`Skill "${skillName}" not found. Available skills: ${Array.from(loadSkills().keys()).join(", ")}`);
      }
      return;
    }

    // Handle skill unload command (/unload name)
    if (trimmed.startsWith("/unload ")) {
      const name = trimmed.replace("/unload ", "").trim().split(/\s+/)[0];
      const unloaded = this.unloadSkill(name) || this.unloadSkill(`skill:${name}`);
      this.addAssistantMessage(unloaded ? `Skill "${name}" unloaded.` : `Skill "${name}" not found in active skills.`);
      return;
    }

    // Handle /skills (list available skills)
    if (trimmed === "/skills" || trimmed === "/skill" || trimmed === "/skills ") {
      const all = loadSkills();
      const active = this.getActiveSkillNames();
      const lines = ["## Available Skills", ""];
      for (const [name, s] of all) {
        const status = active.includes(name) ? " (active)" : "";
        lines.push(`- /skill:${name} — ${s.description}${status}`);
      }
      this.addAssistantMessage(lines.join("\n"));
      return;
    }

    this.addUserMessage(userText);

    for (let i = 0; i < this.cfg.maxIterations; i++) {
      if (signal?.aborted) {
        this.addAssistantMessage("Request cancelled.");
        this.setState("idle");
        return;
      }

      // Rate limiting: delay between LLM calls to avoid hitting provider rate limits
      if (i > 0 && (this.cfg.rateLimitMs ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, this.cfg.rateLimitMs));
      }

      // Check and compact context if needed
      this.checkAndCompactContext();

      let assistantMsg: Message;

       if (this.streaming) {
         // Streaming mode: create partial message, fill it in as chunks arrive
         assistantMsg = {
           id: rnd(),
           role: "assistant",
           content: "",
           timestamp: now(),
         };
         this.messages.push(assistantMsg);
         this.contextManager.addMessage(assistantMsg);

        try {
          const stream = streamChat(
            this.client,
            this.cfg,
            this.toChatMessages(),
            toOpenAI(tools, this.cfg),
            signal
          );

          let hasToolCalls = false;
          let toolCallBuffers: Array<{ id: string; name: string; arguments: string }> = [];
          let streamUsage: { input_tokens: number; output_tokens: number } | undefined;

          // Use iterator protocol to capture the generator's return value (usage)
          const iter = stream[Symbol.asyncIterator]();
          let iterResult = await iter.next();
          while (!iterResult.done) {
            const chunk = iterResult.value;
            if (signal?.aborted) break;

            // DEBUG: trace every chunk
            if (process.env.QWEN_DEBUG_LLM) {
              console.error("[QWEN_DEBUG] agent chunk:", JSON.stringify(chunk.content), "reasoning:", JSON.stringify(chunk.reasoningContent), "toolCalls:", chunk.toolCalls?.length);
            }

            assistantMsg.content += chunk.content || "";
            if (chunk.reasoningContent) {
              assistantMsg.reasoningContent = (assistantMsg.reasoningContent || "") + chunk.reasoningContent;
            }

            // Fallback: some models embed reasoning in <think>…</think> tags inside content
            if (!assistantMsg.reasoningContent && assistantMsg.content.includes("<think>")) {
              const thinkMatch = assistantMsg.content.match(/<think>([\s\S]*?)<\/think>/);
              if (thinkMatch) {
                assistantMsg.reasoningContent = thinkMatch[1].trim();
                assistantMsg.content = assistantMsg.content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
              }
            }

            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              hasToolCalls = true;
              toolCallBuffers = chunk.toolCalls.map((tc: { id: string; name: string; arguments: string }) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              }));
            }

            this.onUpdate?.();
            iterResult = await iter.next();
          }

          streamUsage = (iterResult.value as { usage?: { input_tokens: number; output_tokens: number } })?.usage;
          if (streamUsage) {
            this.lastUsage = streamUsage;
            this.totalUsage.input_tokens += streamUsage.input_tokens;
            this.totalUsage.output_tokens += streamUsage.output_tokens;
          }

          if (hasToolCalls && toolCallBuffers.length > 0) {
            assistantMsg.toolCalls = toolCallBuffers;
          }

          // Some models (notably Nemotron) may emit tool calls with empty content in streaming mode.
          // Add a minimal preface so the UI shows streaming text above the tool call list.
          if (
            assistantMsg.toolCalls?.length &&
            assistantMsg.content.trim() === "" &&
            !assistantMsg.reasoningContent
          ) {
            const first = assistantMsg.toolCalls[0];
            const toolNames = assistantMsg.toolCalls
              .map((t) => t.name)
              .slice(0, 3)
              .join(", ");
            assistantMsg.content =
              toolNames.length > 0
                ? `I will use ${toolNames} to gather the needed context.`
                : `I will use a tool (${first?.name || "tool"}) to gather the needed context.`;
          }

          if (!assistantMsg.toolCalls && assistantMsg.content.trim() === "" && !assistantMsg.reasoningContent) {
            this.messages = this.messages.filter((m) => m.id !== assistantMsg.id);
            this.setState("idle");
            this.onUpdate?.();
            return;
          }

          // Reasoning-only: model was just thinking, loop back for actual content
          if (!assistantMsg.toolCalls && assistantMsg.content.trim() === "" && assistantMsg.reasoningContent) {
            continue;
          }

          // No tool calls = we're done (has real content, this is the final answer)
          if (!assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0) {
            this.setState("idle");
            this.onUpdate?.();
            return;
          }
        } catch (err: any) {
          const status = err?.status || err?.status_code;
          const msg = err?.message || String(err);
          if (status === 401) {
            assistantMsg.content = `Authentication failed: ${msg}\n\nCheck your API key.`;
          } else {
            assistantMsg.content = `API error (${status || "unknown"}): ${msg}`;
          }
          this.setState("error");
          this.onUpdate?.();
          return;
        }
       } else {
         // Non-streaming mode
         let response: Awaited<ReturnType<typeof chat>>;
         
         // Check and compact context if needed
         this.checkAndCompactContext();
         
         try {
           response = await chat(
             this.client,
             this.cfg,
             this.toChatMessages(),
             toOpenAI(tools, this.cfg),
             signal
           );
        } catch (err: any) {
          const status = err?.status || err?.status_code;
          const msg = err?.message || String(err);
          if (status === 401) {
            this.addAssistantMessage(
              `Authentication failed: ${msg}\n\nCheck your API key.`
            );
          } else {
            this.addAssistantMessage(`API error (${status || "unknown"}): ${msg}`);
          }
          this.setState("error");
          return;
        }

        const msg = response.message;
        assistantMsg = {
          id: rnd(),
          role: "assistant",
          content: msg.content || "",
          reasoningContent: msg.reasoning_content || undefined,
          timestamp: now(),
        };
        if (msg.tool_calls) {
          assistantMsg.toolCalls = msg.tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          }));
         }
         this.messages.push(assistantMsg);
         this.contextManager.addMessage(assistantMsg);

         if (!msg.tool_calls || msg.tool_calls.length === 0) {
          // If reasoning-only (no content, no tools), loop back instead of stopping
          if (!msg.content && msg.reasoning_content) {
            continue;
          }
          this.setState("idle");
          if (response.usage) {
            this.lastUsage = response.usage;
            this.totalUsage.input_tokens += response.usage.input_tokens;
            this.totalUsage.output_tokens += response.usage.output_tokens;
          }
          return;
        }
      }

      // Abort gate: if signal fired during the LLM call, stop here
      if (signal?.aborted) {
        this.addAssistantMessage("Request cancelled.");
        this.setState("idle");
        this.onUpdate?.();
        return;
      }

        // Execute tools (shared between streaming and non-streaming)
        const tcs = assistantMsg.toolCalls || [];
        
        // Group tools for parallel execution
        const { parallel, sequential } = groupToolsForParallelExecution(tcs);
        
        // Execute parallel tools first
        if (parallel.length > 0) {
          await this.executeToolsParallel(parallel, signal);
        }
        
        // Execute sequential tools
        for (const tc of sequential) {
          await this.executeToolSequential(tc, signal);
        }
    }

    this.addAssistantMessage("Max iterations reached without completion.");
    this.setState("error");
  }

  /**
   * Parse tool arguments from a tool call.
   */
  private parseToolArgs(tc: { name: string; arguments: string }): any {
    let args: any;
    if (typeof tc.arguments === 'string') {
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        const jsonMatch = tc.arguments.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            args = JSON.parse(jsonMatch[0]);
          } catch {
            args = { raw_input: tc.arguments };
          }
        } else {
          args = { raw_input: tc.arguments };
        }
      }
    } else {
      args = tc.arguments;
    }
    return args;
  }

  /**
   * Execute a single tool sequentially.
   */
  private async executeToolSequential(tc: { name: string; arguments: string; id: string }, signal?: AbortSignal): Promise<void> {
    const tool = tools.find((t) => t.name === tc.name);
    
    this.currentTool = { name: tc.name, args: tc.arguments };
    this.setState("executing_tool");

    const start = performance.now();
    let output: string;
    let wasCached = false;
    
    try {
      const args = this.parseToolArgs(tc);
      
      // Check cache first
      const cached = this.toolCache.get(tc.name, args, this.cfg.workspace);
      if (cached) {
        output = cached.result;
        wasCached = true;
        const duration = cached.duration;
        
        this.addToolMessage(output, tc.id);
        
        const finalOutput = output;
        this.onToolResult?.({
          toolCallId: tc.id,
          name: tc.name,
          output: finalOutput,
          duration,
          cached: true,
        });
        this.currentTool = undefined;
        return;
      }
      
      // Create config with security manager
      const configWithSecurity = {
        ...this.cfg,
        securityManager: this.securityManager,
      };
      
      if (tool?.executeAsync) {
        const subHooks: ToolExecutionHooks | undefined =
          tc.name === "dispatch_subagents" || tc.name === "explore_subagent"
            ? {
                onSubAgentProgress: (progress) => {
                  this.currentTool = {
                    name: tc.name,
                    args: tc.arguments,
                    subAgentProgress: progress,
                  };
                  this.onUpdate?.();
                },
              }
            : undefined;
        output = await tool.executeAsync(
          args,
          this.cfg.workspace,
          configWithSecurity,
          signal,
          subHooks
        );
      } else {
        output = tool
          ? tool.execute(args, this.cfg.workspace, configWithSecurity)
          : JSON.stringify({ ok: false, error: "Unknown tool" });
      }
    } catch (e: any) {
      output = JSON.stringify({ ok: false, error: e.message });
    }
    const duration = performance.now() - start;
    
    // Cache successful results
    if (!wasCached && tool) {
      try {
        const args = this.parseToolArgs(tc);
        const resultObj = JSON.parse(output);
        if (resultObj.ok !== false) {
          this.toolCache.set(tc.name, args, this.cfg.workspace, output, duration, true);
        }
      } catch {
        // If we can't parse the output, don't cache it
      }
    }

    this.messages.push({
      id: rnd(),
      role: "tool",
      content: output,
      timestamp: now(),
      toolCallId: tc.id,
    });

    // Handle special tool results
    this.handleSpecialToolResults(tc.name, output, tc.id);

    const finalOutput = this.messages[this.messages.length - 1]?.content || output;
    this.onToolResult?.({
      toolCallId: tc.id,
      name: tc.name,
      output: finalOutput,
      duration,
    });
    this.currentTool = undefined;
  }

  /**
   * Execute multiple tools in parallel.
   */
  private async executeToolsParallel(
    parallelTools: Array<{ name: string; arguments: string; index: number; id: string }>,
    signal?: AbortSignal
  ): Promise<void> {
    this.setState("executing_tool");
    
    const start = performance.now();
    const results: Array<{ index: number; id: string; output: string; duration: number; wasCached: boolean }> = [];
    
    // Execute all parallel tools concurrently
    const promises = parallelTools.map(async (tc) => {
      const tool = tools.find((t) => t.name === tc.name);
      const toolStart = performance.now();
      let output: string;
      let wasCached = false;
      
      try {
        const args = this.parseToolArgs(tc);
        
        // Check cache first
        const cached = this.toolCache.get(tc.name, args, this.cfg.workspace);
        if (cached) {
          output = cached.result;
          wasCached = true;
          return { index: tc.index, id: tc.id, output, duration: cached.duration, wasCached };
        }
        
         // Execute the tool
        // Create config with security manager
        const configWithSecurity = {
          ...this.cfg,
          securityManager: this.securityManager,
        };
        
        if (tool?.executeAsync) {
          output = await tool.executeAsync(
            args,
            this.cfg.workspace,
            configWithSecurity,
            signal
          );
        } else {
          output = tool
            ? tool.execute(args, this.cfg.workspace, configWithSecurity)
            : JSON.stringify({ ok: false, error: "Unknown tool" });
        }
        
        // Cache successful results
        if (tool) {
          try {
            const resultObj = JSON.parse(output);
            if (resultObj.ok !== false) {
              const duration = performance.now() - toolStart;
              this.toolCache.set(tc.name, args, this.cfg.workspace, output, duration, true);
            }
          } catch {
            // If we can't parse the output, don't cache it
          }
        }
        
        return { index: tc.index, id: tc.id, output, duration: performance.now() - toolStart, wasCached };
      } catch (e: any) {
        return { index: tc.index, id: tc.id, output: JSON.stringify({ ok: false, error: e.message }), duration: performance.now() - toolStart, wasCached: false };
      }
    });
    
    // Wait for all parallel tools to complete
    const settledResults = await Promise.allSettled(promises);
    
    // Process results in original order
    for (const result of settledResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // Handle rejected promises
        results.push({
          index: -1,
          id: '',
          output: JSON.stringify({ ok: false, error: result.reason?.message || 'Unknown error' }),
          duration: 0,
          wasCached: false
        });
      }
    }
    
    // Sort by original index to maintain order
    results.sort((a, b) => a.index - b.index);
    
     // Add messages in order
     for (const result of results) {
       this.addToolMessage(result.output, result.id);
       
       // Handle special tool results
       const tc = parallelTools.find(t => t.id === result.id);
       if (tc) {
         this.handleSpecialToolResults(tc.name, result.output, tc.id);
       }
      
      this.onToolResult?.({
        toolCallId: result.id,
        name: parallelTools.find(t => t.id === result.id)?.name || '',
        output: result.output,
        duration: result.duration,
        cached: result.wasCached,
      });
    }
    
    this.currentTool = undefined;
  }

  /**
   * Handle special tool results that require agent state updates.
   */
  private handleSpecialToolResults(toolName: string, output: string, toolCallId: string): void {
    // Intercept change_workspace results to sync agent state
    if (toolName === "change_workspace") {
      try {
        const result = JSON.parse(output);
        if (result.ok && result.workspace) {
          void this.reconfigure({ workspace: result.workspace });
          this.todos = [];
          this.syncTodoMessage();
          this.onUpdate?.();
        }
      } catch {
        // ignore parse errors
      }
    }

    // Invalidate cache for file modification tools
    if (['write_file', 'edit_file', 'edit_file_lines'].includes(toolName)) {
      this.toolCache.clear();
    }

    // Invalidate cache for git operations that change files
    if (toolName === 'git_commit') {
      this.toolCache.clear();
    }

    // Intercept manage_todos results to sync agent state
    if (toolName === "manage_todos") {
      try {
        const result = JSON.parse(output);
        if (result.ok) {
          const lastMsg = this.messages[this.messages.length - 1];
          if (result.action === "add" && result.text) {
            if (result.id) {
              this.todos.push({
                id: result.id,
                text: result.text,
                done: result.done !== undefined ? result.done : false,
                createdAt: result.createdAt || now(),
              });
            } else {
              this.addTodo(result.text);
            }
            const newTodo = this.todos[this.todos.length - 1];
            if (lastMsg && newTodo) {
              lastMsg.content = JSON.stringify({
                ok: true,
                action: "add",
                id: newTodo.id,
                text: newTodo.text,
              });
            }
            this.syncTodoMessage();
            this.onUpdate?.();
          } else if (result.action === "complete") {
            const target = this.todos.find((t) => t.id === result.id);
            if (target) {
              this.toggleTodo(result.id);
              if (lastMsg) {
                lastMsg.content = JSON.stringify({
                  ok: true,
                  action: "complete",
                  id: result.id,
                  text: target.text,
                });
              }
            } else {
              if (lastMsg) {
                lastMsg.content = JSON.stringify({
                  ok: false,
                  action: "complete",
                  error: `Todo id=${result.id} not found`,
                });
              }
            }
          } else if (result.action === "remove") {
            const target = this.todos.find((t) => t.id === result.id);
            if (target) {
              this.removeTodo(result.id);
              if (lastMsg) {
                lastMsg.content = JSON.stringify({
                  ok: true,
                  action: "remove",
                  id: result.id,
                  text: target.text,
                });
              }
            } else {
              if (lastMsg) {
                lastMsg.content = JSON.stringify({
                  ok: false,
                  action: "remove",
                  error: `Todo id=${result.id} not found`,
                });
              }
            }
          } else if (result.action === "list") {
            if (lastMsg) {
              lastMsg.content = JSON.stringify({
                ok: true,
                action: "list",
                count: this.todos.length,
                todos: this.todos.map((t) => ({ id: t.id, text: t.text, done: t.done })),
              });
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  /** Build a short todo context string for the todo system message. */
  private buildTodoContext(): string {
    const pending = this.todos.filter((t) => !t.done);
    const done = this.todos.filter((t) => t.done);
    if (pending.length === 0 && done.length === 0) {
      return "Current todo list: (empty — no todos yet)";
    }
    let text = "Current todo list (use the id in manage_todos):\n";
    for (const t of pending) {
      text += `  - [ ] id=${t.id} | ${t.text}\n`;
    }
    for (const t of done) {
      text += `  - [x] id=${t.id} | ${t.text}\n`;
    }
    return text.trim();
  }

  /** Sync the dedicated todo system message for internal tracking (filtered out before sending to LLM). */
  private syncTodoMessage() {
    const idx = this.messages.findIndex(
      (m) => m.role === "system" && m.id === "system-todos"
    );
    const content = this.buildTodoContext();
    if (idx >= 0) {
      this.messages[idx].content = content;
    } else {
      this.messages.unshift({
        id: "system-todos",
        role: "system",
        content,
        timestamp: now(),
      });
    }
  }

  /** Convert internal messages to the format expected by the LLM layer. */
  private toChatMessages(): ChatMessage[] {
    // Ensure todo message is fresh before sending to LLM
    this.syncTodoMessage();

    // Filter out internal/empty messages that can poison the next chat template turn.
    // Keep only the main system prompt and todo system message.
    // Other system messages (like "Connected to LM Studio") are filtered out
    // because Qwen's Jinja template requires system messages at the beginning.
    const messagesToSend = this.messages.filter(
      (m) =>
        !(m.role === "system" && m.id === "system-todos") &&
        !(m.role === "system" && m.id !== "system-base") &&
        !(m.role === "assistant" && !m.toolCalls && !m.reasoningContent && m.content.trim() === "")
    );

    return messagesToSend.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId!,
        };
      }
      if (m.role === "assistant" && m.toolCalls) {
        return {
          role: "assistant" as const,
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      if (m.role === "assistant" && m.reasoningContent) {
        return {
          role: "assistant" as const,
          content: m.content,
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  /** Append an assistant message and trigger an update. */
  private addAssistantMessage(content: string) {
    const msg: Message = {
      id: rnd(),
      role: "assistant",
      content,
      timestamp: now(),
    };
    this.messages.push(msg);
    this.contextManager.addMessage(msg);
    this.onUpdate?.();
  }

  /**
   * Add a user message to the conversation.
   */
  private addUserMessage(content: string): void {
    const msg: Message = {
      id: rnd(),
      role: "user",
      content,
      timestamp: now(),
    };
    this.messages.push(msg);
    this.contextManager.addMessage(msg);
    this.onUpdate?.();
  }

  /**
   * Add a tool message to the conversation.
   */
  private addToolMessage(content: string, toolCallId?: string): void {
    const msg: Message = {
      id: rnd(),
      role: "tool",
      content,
      timestamp: now(),
      toolCallId,
    };
    this.messages.push(msg);
    this.contextManager.addMessage(msg);
    this.onUpdate?.();
  }

  /**
   * Check if context needs compaction and perform it if necessary.
   * Returns true if compaction was performed.
   */
  private checkAndCompactContext(): boolean {
    if (!this.contextManager.needsCompaction()) {
      return false;
    }

    const result = this.contextManager.compact();
    
    if (result.removedCount > 0) {
      // Add a system message about compaction
      if (result.summary) {
        this.addAssistantMessage(result.summary);
      }
      return true;
    }
    
    return false;
  }

  /**
   * Ensure there's enough context space for the next message.
   * Compacts if necessary.
   */
  private ensureContextSpace(message: Message): void {
    if (!this.contextManager.canFitMessage(message)) {
      this.checkAndCompactContext();
    }
  }

  /** Update agent state and notify listeners. */
  private setState(s: AgentState) {
    this.state = s;
    this.onUpdate?.();
  }

  /** Add a new todo item. */
  addTodo(text: string) {
    this.todos.push({ id: rnd(), text, done: false, createdAt: now() });
    this.syncTodoMessage();
    this.onUpdate?.();
  }

  /** Toggle the done state of a todo. */
  toggleTodo(id: string) {
    const t = this.todos.find((x) => x.id === id);
    if (t) {
      t.done = !t.done;
      this.syncTodoMessage();
      this.onUpdate?.();
    }
  }

  /** Remove a todo by id. */
  removeTodo(id: string) {
    this.todos = this.todos.filter((x) => x.id !== id);
    this.syncTodoMessage();
    this.onUpdate?.();
  }

  /** Load a skill into the active context. Returns true if loaded. */
  loadSkill(skill: Skill): boolean {
    if (this.activeSkills.has(skill.name)) return false;
    this.activeSkills.set(skill.name, skill);

    this._autoLoadedSkills.add(skill.name);
    this._syncSkillMessages();
    this.onUpdate?.();
    return true;
  }

  /** Unload a skill from the active context. Returns true if unloaded. */
  unloadSkill(name: string): boolean {
    if (!this.activeSkills.has(name)) return false;
    this.activeSkills.delete(name);

    this._autoLoadedSkills.delete(name);
    this._syncSkillMessages();
    this.onUpdate?.();
    return true;
  }

  /** Rebuild the system-base message to include active skill prompts. */
  private _syncSkillMessages(): void {
    const base = this.messages.find((m) => m.id === "system-base");
    if (!base) return;

    const cleanBase = base.content.replace(/\n\n## Active skill[\s\S]*?(?=\n\n##|$)/g, "").trimEnd();

    const skillCharCap = this._smallModel ? 6000 : 3500;
    let skillSection = "";
    for (const [name, skill] of this.activeSkills) {
      let prompt = (skill.prompt || "").replace(/\bbash\b/g, "execute_command");
      if (prompt.length > skillCharCap) {
        prompt =
          prompt.slice(0, skillCharCap) +
          `\n\n[Skill truncated to ${skillCharCap} chars for context efficiency.]`;
      }
      skillSection += `\n\n## Active skill: ${name}\n${prompt}`;
    }

    base.content = cleanBase + skillSection;
  }

  /** Get list of actively loaded skill names. */
  getActiveSkillNames(): string[] {
    return Array.from(this.activeSkills.keys());
  }

  /** Auto-load skills matching user input triggers. Called before processing input. */
  autoLoadMatchingSkills(userText: string): Skill[] {
    const allSkills = loadSkills();
    const matched = matchSkillTriggers(userText, allSkills);

    const newlyLoaded: Skill[] = [];
    for (const skill of matched) {
      if (this._autoLoadedSkills.has(skill.name)) continue;
      if (this.activeSkills.has(skill.name)) continue;
      this.loadSkill(skill);
      newlyLoaded.push(skill);
    }

    return newlyLoaded;
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

function now() {
  return Date.now();
}