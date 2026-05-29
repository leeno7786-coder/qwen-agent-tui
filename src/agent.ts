import { createClient, chat, streamChat, isSmallModel } from "./llm";
import type { ChatMessage } from "./llm";
import { tools, toOpenAI } from "./tools";
import { detectContext } from "./context";
import { loadSkills } from "./skills";
import type { Config, Message, ToolResult, AgentState, Todo } from "./types";

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
  public currentTool?: { name: string; args: string };
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


  /**
   * @param cfg - Agent configuration.
   */
  constructor(cfg: Config) {
    this.cfg = cfg;
    this.client = createClient(cfg);
  }

  /**
   * Reconfigure the agent with a new configuration.
   * This recreates the client with the new config.
   * @param newCfg - New configuration.
   */
  reconfigure(newCfg: Partial<Config>) {
    this.cfg = { ...this.cfg, ...newCfg };
    this.client = createClient(this.cfg);
  }

  /**
   * Initialise the agent: detect workspace context, load skills,
   * and push the system message.
   */
  async init() {
    const ctx = detectContext(this.cfg.workspace);
    const skills = loadSkills();
    
    // Small model optimization: simpler system prompt
    const smallModel = isSmallModel(this.cfg.model, this.cfg.maxTokens);
    
    // Inject active skill prompt if any skill is currently active
    let activeSkillPrompt = "";
    for (const [name, skill] of skills) {
      if (!skill.enabled && !skill.command) continue;
      // Check if this skill should be active based on context or user preference
      const isActive = skill.enabled === true || 
                     (this.cfg.systemPrompt?.includes(`skill:${name}`));
      if (isActive && skill.prompt) {
        // Update skill prompts to reference correct tool names
        let updatedPrompt = skill.prompt;
        // Map legacy "bash" tool references to "execute_command"
        updatedPrompt = updatedPrompt.replace(/bash/g, "execute_command");
        activeSkillPrompt += `\n${updatedPrompt}\n`;
      }
    }
    
    let system = this.cfg.systemPrompt ||
      (smallModel 
        ? `You are Qwen Agent. Work in: ${this.cfg.workspace}

# Tools
- read_file(path, offset?, limit?): Read a file with optional line range
- write_file(path, content): Write or create a file
- edit_file(path, old_text, new_text): Replace exact text safely
- edit_file_lines(path, start_line, end_line, new_text): Replace by line number (use when edit_file fails)
- list_dir(path, limit?): List files and directories
- stat_path(path): Get file or directory metadata
- find_files(query, path?, regex?, max_depth?): Find files by name or regex
- grep_search(query, file_glob?, regex?): Search text in files
- search_and_view(pattern, path?, file_pattern?, context_lines?, regex?): Search with context lines around matches
- edit_file_lines(path, start_line, end_line, new_text): Replace a range of lines by number (use when edit_file fails)
- execute_command(cmd): Run any shell command (PowerShell on Windows)
- git_status(): Show git repo status
- git_diff(): View uncommitted changes
- git_commit(message): Stage all and commit
- change_workspace(path): Change active directory
- manage_todos(action, text?, id?): Track subtasks

Rules:
- Read files before modifying them
- Break complex tasks into steps
- Be concise and direct
- Use execute_command for all shell/git/test operations`
        : `You are Qwen Agent, a senior software engineer. You help users by reading files, running commands, and modifying code. You work in: ${this.cfg.workspace}

# Tools
- read_file(path, offset?, limit?): Read a file with optional line range
- write_file(path, content): Write or create a file (creates dirs automatically)
- edit_file(path, old_text, new_text): Replace exact text safely
- edit_file_lines(path, start_line, end_line, new_text): Replace by line number (use when edit_file fails)
- list_dir(path, limit?): List files and directories
- map_project_tree(path, max_depth?, include_hidden?): Get project structure as a tree
- stat_path(path): Get file or directory metadata
- find_files(query, path?, regex?, max_depth?): Find files by name or regex
- grep_search(query, file_glob?, regex?): Search text in files
- search_and_view(pattern, path?, file_pattern?, context_lines?, regex?): Search with context lines around matches
- batch_read_files(paths): Read multiple files at once
- git_status(): Show git repo status
- git_diff(): View uncommitted changes
- git_commit(message): Stage all and commit
- execute_command(cmd): Run any shell command (auto-translates Unix to PowerShell on Windows)
- run_tests(): Run project test suite
- install_dependencies(): Install project dependencies
- run_command(build|lint|format): Run lifecycle scripts
- typecheck(): Run tsc --noEmit
- change_workspace(path): Change active directory
- manage_todos(action, text?, id?): Track subtasks (add/complete/remove/list)

# Ask When Uncertain
ASK before proceeding when:
- Confusing or contradictory file contents
- Unclear project structure or requirements  
- Mixed-language files that don't make sense for the project type
- Any situation where you're uncertain about the next step

# Best Practices
- Identify project language/framework by examining key files (package.json, requirements.txt, Cargo.toml)
- Use execute_command for all shell operations
- Use map_project_tree for hierarchical project structure
- Ignore files irrelevant to the current project type
- Prioritize source code over test/example files during analysis`);
    
    if (this.cfg.allowedPaths?.length)
      system += `\nApproved extra paths: ${this.cfg.allowedPaths.join(", ")}`;
    if (ctx.isGit)
      system += `\nGit branch: ${ctx.branch}`;
    // Removed project type injection - model should detect this itself
    if (skills.size > 0)
      system += `\nAvailable skills: ${Array.from(skills.keys()).join(", ")}`;
    if (process.platform === "win32") {
      system +=
        "\n\nActive Platform: Windows PowerShell. " +
        "Use PowerShell commands only.";
    }
    system += smallModel
      ? "\n\nTODO RULES:\n- Break multi-step requests into subtasks with manage_todos\n- Mark each done with manage_todos\n- Always use the tool, never describe what you would do"
      : "\n\n🔧 TODO RULES (MUST FOLLOW):\n- You MUST break every multi-step request into subtasks using `manage_todos(action: 'add', text: '...')`.\n- You MUST mark each done with `manage_todos(action: 'complete', id: '...')`.\n- You MUST NOT describe todos — you MUST call the tool.\n- If you skip this, the task will stall.";
    this.messages = [
      { id: "system-base", role: "system", content: system, timestamp: now() },
    ];
    this.syncTodoMessage();

    // Scale round/iteration limits for small models
    if (smallModel) {
      this._smallModel = true;
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

    this.messages.push({
      id: rnd(),
      role: "user",
      content: userText,
      timestamp: now(),
    });

    for (let i = 0; i < this.cfg.maxIterations; i++) {
      if (signal?.aborted) {
        this.addAssistantMessage("Request cancelled.");
        this.setState("idle");
        return;
      }

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
              console.error("[agent chunk] content:", JSON.stringify(chunk.content), "reasoning:", JSON.stringify(chunk.reasoningContent), "toolCalls:", chunk.toolCalls?.length);
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
        for (const tc of tcs) {
          const tool = tools.find((t) => t.name === tc.name);

          this.currentTool = { name: tc.name, args: tc.arguments };
          this.setState("executing_tool");

          const start = performance.now();
          let output: string;
          try {
            // Robust argument parsing (handles malformed JSON from any model)
            let args: any;
            if (typeof tc.arguments === 'string') {
              // Try multiple parsing strategies for small models
              try {
                args = JSON.parse(tc.arguments);
              } catch {
                // Try to extract JSON from text
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
            
            output = tool
              ? tool.execute(args, this.cfg.workspace, this.cfg)
              : JSON.stringify({ ok: false, error: "Unknown tool" });
          } catch (e: any) {
            output = JSON.stringify({ ok: false, error: e.message });
          }
          const duration = performance.now() - start;

        this.messages.push({
          id: rnd(),
          role: "tool",
          content: `Result of ${tc.name}:\n${output}`,
          timestamp: now(),
          toolCallId: tc.id,
        });

        // Intercept change_workspace results to sync agent state
        if (tc.name === "change_workspace") {
          try {
            const result = JSON.parse(output);
            if (result.ok && result.workspace) {
              this.reconfigure({ workspace: result.workspace });
              this.todos = [];
              this.syncTodoMessage();
              this.onUpdate?.();
            }
          } catch {
            // ignore parse errors
          }
        }

        // Intercept manage_todos results to sync agent state
        if (tc.name === "manage_todos") {
          try {
            const result = JSON.parse(output);
            if (result.ok) {
              const lastMsg = this.messages[this.messages.length - 1];
              if (result.action === "add" && result.text) {
                // Use the id from tool result if provided, otherwise let addTodo generate one
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
                // Update tool result with the generated id so the model can reference it
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
                const lastMsg = this.messages[this.messages.length - 1];
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

        const finalOutput = this.messages[this.messages.length - 1]?.content || output;
        this.onToolResult?.({
          toolCallId: tc.id,
          name: tc.name,
          output: finalOutput,
          duration,
        });
        this.currentTool = undefined;
      }
    }

    this.addAssistantMessage("Max iterations reached without completion.");
    this.setState("error");
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
    const messagesToSend = this.messages.filter(
      (m) =>
        !(m.role === "system" && m.id === "system-todos") &&
        !(m.role === "assistant" && !m.toolCalls && m.content.trim() === "")
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
    this.messages.push({
      id: rnd(),
      role: "assistant",
      content,
      timestamp: now(),
    });
    this.onUpdate?.();
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
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

function now() {
  return Date.now();
}