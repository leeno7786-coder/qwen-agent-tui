/** @jsxImportSource @opentui/react */

import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import type { CliRenderer } from "@opentui/core";
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { AgentCore } from "../agent";
import { loadConfig } from "../config";
import { estimateModelContextSize, getModelCompactionSettings, countTokens, doesChatFitInContext } from "../llm";
import { tools } from "../tools";
import {
  loadTodos,
  saveTodos,
  saveSession,
  loadSessions,
  deleteSession,
  renameSession,
  copyToClipboard,
  exportToMarkdown,
  autoSaveSession,
  resumeSession,
  loadInputHistory,
  saveInputHistory,
} from "../store";
import type { Message, AgentState, Todo, ToolResult, Session, Skill, SkillCommand, Config } from "../types";
import { ChatScreen } from "./chat-screen";
import { ErrorBoundary } from "./error-boundary";
import { HelpOverlay, HistoryOverlay } from "./overlays";
import { SkillsOverlay } from "./skills-overlay";
import { ConnectOverlay } from "./connect-overlay";
import { StatusBar } from "./status-bar";
import { TodoSidebar } from "./todo-sidebar";
import { THEMES, DEFAULT_THEME, type Theme } from "./theme";
import { loadSkills, getSkillCommands, getSkill } from "../skills";
import { getProviderBaseURL } from "../providers";

/**
 * Simple token estimation function.
 * This is a rough approximation - in reality, tokenizers vary by model.
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokenCount(text: string): number {
  try { return countTokens(text); } catch {}
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the approximate token count of the entire conversation.
 * @param messages - Array of messages
 * @returns Total estimated token count
 */
function calculateConversationTokenCount(messages: Message[]): number {
  return messages.reduce((total, message) => {
    let count = 0;
    
    // Count tokens in message content
    if (message.content) {
      count += estimateTokenCount(message.content);
    }
    
    // Count tokens in tool calls if present
    if (message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        count += estimateTokenCount(toolCall.name || '');
        if (toolCall.arguments) {
          count += estimateTokenCount(JSON.stringify(toolCall.arguments));
        }
      }
    }
    
    // Count tokens in tool results if present
    if (message.role === 'tool' && message.content) {
      count += estimateTokenCount(message.content);
    }
    
    return total + count;
  }, 0);
}

/**
 * Check if the conversation needs auto-compaction and perform it if necessary.
 * Uses rolling window approach: keeps recent messages and summarizes older ones.
 * @param agent - The agent instance
 * @param setMessages - React state setter for messages
 */
function checkAndAutoCompact(agent: AgentCore, setMessages: React.Dispatch<React.SetStateAction<Message[]>>) {
  const settings = getModelCompactionSettings(agent.cfg.model, agent.cfg.maxTokens);
  const { contextSize, compactThreshold, summaryReservedPercent, keepCount } = settings;
  
  // Calculate current conversation token count
  const currentTokenCount = calculateConversationTokenCount(agent.messages);
  
  // If we're over the threshold, use rolling window compaction
  if (currentTokenCount > compactThreshold) {
    const sys = agent.messages.filter((m) => m.role === "system");
    const rest = agent.messages.filter(
      (m) =>
        m.role !== "system" &&
        !(m.role === "assistant" && !m.toolCalls && m.content.trim() === "")
    );
    
    // Rolling window: keep the most recent messages
    const kept = rest.slice(-keepCount);
    const removed = rest.slice(0, -keepCount);
    
    // Generate a summary of removed messages if there are any
    let summaryContent = "";
    if (removed.length > 0) {
      // Extract key information from removed messages for summary
      const toolCalls = removed.filter(m => m.toolCalls && m.toolCalls.length > 0);
      const userMessages = removed.filter(m => m.role === "user");
      const assistantMessages = removed.filter(m => m.role === "assistant" && m.content);
      
      const summaryParts: string[] = [];
      
      // Summarize tool usage
      if (toolCalls.length > 0) {
        const toolNames = new Set<string>();
        toolCalls.forEach(tc => tc.toolCalls?.forEach(t => toolNames.add(t.name || "unknown")));
        summaryParts.push(`Tools used: ${Array.from(toolNames).join(", ")}`);
      }
      
      // Summarize user requests
      if (userMessages.length > 0) {
        const keyRequests = userMessages.slice(-3).map(m => m.content.slice(0, 100)).filter(Boolean);
        if (keyRequests.length > 0) {
          summaryParts.push(`Recent requests: ${keyRequests.join("; ")}`);
        }
      }
      
      // Summarize assistant actions
      if (assistantMessages.length > 0) {
        summaryParts.push(`Completed ${assistantMessages.length} response cycles`);
      }
      
      summaryContent = `Summary of ${removed.length} earlier messages: ${summaryParts.join(". ")}.`;
    }
    
    // Build new message array with rolling window
    agent.messages = [
      ...sys,
      ...(summaryContent
        ? [
            {
              id: Math.random().toString(36).slice(2, 10),
              role: "user" as const,
               content: `[Summarized ${removed.length} earlier messages: ${summaryContent}]`,
              timestamp: Date.now(),
            },
          ]
        : []),
      ...kept,
    ];
    
    // Update React state to trigger re-render
    setMessages([...agent.messages]);
  }
}

type Overlay = "help" | "history" | "skills" | "connect" | null;

export function App({ renderer }: { renderer: CliRenderer }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [showTodos, setShowTodos] = useState(false);
  const [mouseEnabled, setMouseEnabled] = useState(true);
  const [theme, setTheme] = useState<Theme>(() => {
    const cfg = loadConfig();
    return THEMES[cfg.theme || ""] || DEFAULT_THEME;
  });

  // Agent state
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<AgentState>("idle");
  const cfg = loadConfig();
  const [todos, setTodos] = useState<Todo[]>(() => loadTodos(cfg.workspace));
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentTool, setCurrentTool] = useState<
    { name: string; args: string } | undefined
  >();
  const [lastUsage, setLastUsage] = useState<
    { input_tokens: number; output_tokens: number } | undefined
  >();
  const [totalUsage, setTotalUsage] = useState({
    input_tokens: 0,
    output_tokens: 0,
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [selectedMessageIndex, setSelectedMessageIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [paginated, setPaginated] = useState(false);
  const [skills, setSkills] = useState<Map<string, Skill>>(new Map());
  const [skillCommands, setSkillCommands] = useState<SkillCommand[]>([]);

  const agentRef = useRef<AgentCore | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const compactTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cfg = loadConfig();
    const agent = new AgentCore(cfg);
    agent.todos = todos;
    agent.onUpdate = () => {
      const lastMsg = agent.messages[agent.messages.length - 1];
      if (process.env.QWEN_DEBUG_LLM) {
        console.error("[app onUpdate] state:", agent.state, "lastMsg.role:", lastMsg?.role, "lastMsg.content:", JSON.stringify(lastMsg?.content?.slice(0, 60)));
      }
      setMessages([...agent.messages]);
      setState(agent.state);
      setTodos([...agent.todos]);
      setCurrentTool(agent.currentTool);
      setLastUsage(agent.lastUsage);
      setTotalUsage({ ...agent.totalUsage });
    };
    agent.onToolResult = (r) => {
      setToolResults((prev) => [...prev.slice(-99), r]);
    };
    agent.init().then(() => {
      agentRef.current = agent;
      setMessages([...agent.messages]);
    });

    // Load skills
    const loadedSkills = loadSkills();
    setSkills(loadedSkills);
    setSkillCommands(getSkillCommands(loadedSkills));
    
    // Set up skill refresh handler
    const handleSkillRefresh = () => {
      const refreshedSkills = loadSkills();
      setSkills(refreshedSkills);
      setSkillCommands(getSkillCommands(refreshedSkills));
    };
    
    // Store refresh handler in global scope for skills overlay to call
    (globalThis as any).__refreshSkills = handleSkillRefresh;

    // Graceful shutdown on SIGINT (Ctrl+C)
    const handleSigint = () => {
      saveTodos(agent.todos, cfg.workspace);
      if (agent && agent.messages.length > 0) {
        autoSaveSession(agent.messages, agent.todos, cfg.workspace);
      }
      process.exit(0);
    };
    process.on("SIGINT", handleSigint);

    // Warn if no API key is configured
    if (!cfg.apiKey || cfg.apiKey.trim() === "") {
      agent.messages.push({
        id: Math.random().toString(36).slice(2, 10),
        role: "system",
        content: "⚠️ No API key configured. Use /connect to select a provider and enter your API key.",
        timestamp: Date.now(),
      });
      setMessages([...agent.messages]);
    }

    return () => {
      process.off("SIGINT", handleSigint);
      abortControllerRef.current?.abort();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (compactTimerRef.current) {
        clearInterval(compactTimerRef.current);
        compactTimerRef.current = null;
      }
      saveTodos(agent.todos, agent.cfg.workspace);
      // Auto-save session on exit
      if (agent && agent.messages.length > 0) {
        autoSaveSession(agent.messages, agent.todos, agent.cfg.workspace);
      }
      // Clean up global skill refresh handler
      delete (globalThis as any).__refreshSkills;
    };
  }, []);

  useEffect(() => {
    if (
      state === "idle" ||
      state === "error" ||
      state === "waiting_for_user"
    ) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedMs(0);
      return;
    }
    if (!timerRef.current) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    }
    
    if (!compactTimerRef.current) {
      compactTimerRef.current = setInterval(() => {
        if (agentRef.current) {
          checkAndAutoCompact(agentRef.current, setMessages);
        }
      }, 5000);
    }
  }, [state]);

  useEffect(() => {
    if (agentRef.current) {
      agentRef.current.todos = todos;
      saveTodos(todos, cfg.workspace);
    }
  }, [todos]);

  // Auto-enable pagination when messages exceed threshold
  const PAGINATION_THRESHOLD = 100;
  const MESSAGES_PER_PAGE = 50;

  useEffect(() => {
    setPaginated(messages.length > PAGINATION_THRESHOLD);
  }, [messages.length]);

  // Reset to page 1 when pagination is disabled
  useEffect(() => {
    if (!paginated) {
      setPage(1);
    }
  }, [paginated]);

  // Auto-save session periodically
  useEffect(() => {
    const agent = agentRef.current;
    if (!agent || agent.messages.length <= 2) return;
    const timer = setTimeout(() => {
      const session = {
        id: "autosave",
        messages: agent.messages,
        todos: agent.todos,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveSession(session);
    }, 3000);
    return () => clearTimeout(timer);
  }, [messages, todos]);

  // Global keyboard shortcuts
  useKeyboard((keyEvent) => {
    if (overlay) {
      if (keyEvent.name === "escape" || keyEvent.name === "Escape") {
        setOverlay(null);
        keyEvent.preventDefault?.();
      }
      return;
    }

    if (keyEvent.name === "escape" || keyEvent.name === "Escape") {
      const busy = state !== "idle" && state !== "error" && state !== "waiting_for_user";
      if (busy) {
        abortControllerRef.current?.abort();
        keyEvent.preventDefault?.();
      }
      return;
    }

    if (keyEvent.name === "f1" || keyEvent.name === "F1") {
      setOverlay("help");
      keyEvent.preventDefault?.();
    } else if (keyEvent.name === "f2" || keyEvent.name === "F2") {
      const agent = agentRef.current;
      if (agent) {
        agent.messages = agent.messages.filter((m) => m.role === "system");
        setMessages([...agent.messages]);
      }
    } else if (keyEvent.name === "f4" || keyEvent.name === "F4") {
      setShowTodos((s) => !s);
    } else if (keyEvent.name === "f5" || keyEvent.name === "F5") {
      handleSave();
    } else if (keyEvent.name === "f6" || keyEvent.name === "F6") {
      setSessions(loadSessions());
      setOverlay("history");
    } else if (keyEvent.name === "f8" || keyEvent.name === "F8") {
      setOverlay("skills");
    } else if (keyEvent.name === "f7" || keyEvent.name === "F7") {
      const next = !mouseEnabled;
      renderer.useMouse = next;
      setMouseEnabled(next);
    } else if (keyEvent.name === "f9" || keyEvent.name === "F9") {
      const names = Object.keys(THEMES);
      const idx = names.indexOf(theme.name);
      const next = names[(idx + 1) % names.length];
      setTheme(THEMES[next]);
    } else if (keyEvent.name === "f10" || keyEvent.name === "F10") {
      const agent = agentRef.current;
      if (agent) {
        autoSaveSession(agent.messages, agent.todos, cfg.workspace);
      }
      process.exit(0);
    }

    // Ctrl+Up/Down: Navigate message selection
    if (keyEvent.ctrl) {
      if (keyEvent.name === "Up" || keyEvent.name === "ArrowUp") {
        const agent = agentRef.current;
        if (agent && agent.messages.length > 0) {
          const nonSystem = agent.messages.filter(m => m.role !== "system");
          setSelectedMessageIndex((prev) => {
            const current = prev !== null ? prev : nonSystem.length - 1;
            const newIndex = Math.min(current + 1, nonSystem.length - 1);
            return newIndex;
          });
          keyEvent.preventDefault?.();
          keyEvent.stopPropagation?.();
        }
      } else if (keyEvent.name === "Down" || keyEvent.name === "ArrowDown") {
        const agent = agentRef.current;
        if (agent && agent.messages.length > 0) {
          const nonSystem = agent.messages.filter(m => m.role !== "system");
          setSelectedMessageIndex((prev) => {
            const current = prev !== null ? prev : 0;
            const newIndex = Math.max(current - 1, 0);
            return newIndex;
          });
          keyEvent.preventDefault?.();
          keyEvent.stopPropagation?.();
        }
      } else if (keyEvent.name === "c" || keyEvent.name === "C") {
        // Ctrl+C: Copy selected message
        const agent = agentRef.current;
        if (agent && selectedMessageIndex !== null) {
          const nonSystem = agent.messages.filter(m => m.role !== "system");
          const selectedMessage = nonSystem[selectedMessageIndex];
          if (selectedMessage) {
            const success = copyToClipboard(selectedMessage.content);
            if (!success) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Copied message ${selectedMessage.id.slice(0, 8)} to clipboard.`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            setSelectedMessageIndex(null);
          }
          keyEvent.preventDefault?.();
          keyEvent.stopPropagation?.();
        }
      }
    }

    // Escape: Clear message selection
    if ((keyEvent.name === "escape" || keyEvent.name === "Escape") && selectedMessageIndex !== null) {
      setSelectedMessageIndex(null);
      keyEvent.preventDefault?.();
      keyEvent.stopPropagation?.();
    }
  });

  const handleSave = useCallback(() => {
    const agent = agentRef.current;
    if (!agent) return;
    const id = `session-${Date.now()}`;
    const session: Session = {
      id,
      messages: agent.messages,
      todos: agent.todos,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSession(session);
    setSessions(loadSessions());
    setCurrentSessionId(id);
    const msg: Message = {
      id: Math.random().toString(36).slice(2, 10),
      role: "system",
      content: `Session saved as ${id}.`,
      timestamp: Date.now(),
    };
    agent.messages.push(msg);
    setMessages([...agent.messages]);
  }, []);

  const handleRename = useCallback((newName: string) => {
    const agent = agentRef.current;
    if (!agent) return;

    const name = newName.trim();
    if (!name) {
      agent.messages.push({
        id: Math.random().toString(36).slice(2, 10),
        role: "system",
        content: "Usage: /rename [new-name]. Provide a new name for the current session.",
        timestamp: Date.now(),
      });
      setMessages([...agent.messages]);
      return;
    }

    // If we have a current session, rename it
    if (currentSessionId) {
      const success = renameSession(currentSessionId, name);
      if (success) {
        setCurrentSessionId(name);
        setSessions(loadSessions());
        agent.messages.push({
          id: Math.random().toString(36).slice(2, 10),
          role: "system",
          content: `Session renamed from ${currentSessionId} to ${name}.`,
          timestamp: Date.now(),
        });
        setMessages([...agent.messages]);
      } else {
        agent.messages.push({
          id: Math.random().toString(36).slice(2, 10),
          role: "system",
          content: `Failed to rename session. Session '${currentSessionId}' not found.`,
          timestamp: Date.now(),
        });
        setMessages([...agent.messages]);
      }
      return;
    }

    // Otherwise, save current messages as a new session with the given name
    const id = name;
    const session: Session = {
      id,
      messages: agent.messages,
      todos: agent.todos,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSession(session);
    setSessions(loadSessions());
    setCurrentSessionId(id);
    agent.messages.push({
      id: Math.random().toString(36).slice(2, 10),
      role: "system",
      content: `Session saved as ${id}.`,
      timestamp: Date.now(),
    });
    setMessages([...agent.messages]);
  }, [currentSessionId]);

  const handleLoad = useCallback((session: Session) => {
    const agent = agentRef.current;
    if (!agent) return;
    agent.messages = session.messages;
    agent.todos = session.todos;
    setMessages([...agent.messages]);
    setTodos([...agent.todos]);
    setToolResults([]);
    // Trigger update to sync todo message and refresh UI
    agent.onUpdate?.();
    setOverlay(null);
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    deleteSession(id);
    setSessions(loadSessions());
  }, []);

  const handleSubmit = useCallback(
    async (text: string) => {
      const agent = agentRef.current;
      if (!agent || state !== "idle") return;

      if (text.startsWith("/")) {
        const command = text.trim().substring(1).split(" ")[0];
        const args = text.trim().substring(1 + command.length).trim();

        switch (command) {
          case "help":
            setOverlay("help");
            return;
          case "clear":
            if (agent) {
              agent.messages = agent.messages.filter(
                (m) => m.role === "system"
              );
              setMessages([...agent.messages]);
              setToolResults([]);
            }
            return;
          case "compact": {
            if (!agent) return;
            const modelName = agent.cfg.model.toLowerCase();
            const settings = getModelCompactionSettings(agent.cfg.model, agent.cfg.maxTokens);
            const { contextSize, compactThreshold, summaryReservedPercent, keepCount } = settings;
            
            // Calculate current conversation token count
            const currentTokenCount = calculateConversationTokenCount(agent.messages);
            
            const sys = agent.messages.filter((m) => m.role === "system");
            const rest = agent.messages.filter(
              (m) =>
                m.role !== "system" &&
                !(m.role === "assistant" && !m.toolCalls && m.content.trim() === "")
            );
            
            // Rolling window: keep the most recent messages
            const kept = rest.slice(-keepCount);
            const removed = rest.slice(0, -keepCount);
            
            // Generate a summary of removed messages
            let summaryContent = "";
            if (removed.length > 0) {
              const toolCalls = removed.filter(m => m.toolCalls && m.toolCalls.length > 0);
              const userMessages = removed.filter(m => m.role === "user");
              const assistantMessages = removed.filter(m => m.role === "assistant" && m.content);
              
              const summaryParts: string[] = [];
              
              if (toolCalls.length > 0) {
                const toolNames = new Set<string>();
                toolCalls.forEach(tc => tc.toolCalls?.forEach(t => toolNames.add(t.name || "unknown")));
                summaryParts.push(`Tools used: ${Array.from(toolNames).join(", ")}`);
              }
              
              if (userMessages.length > 0) {
                const keyRequests = userMessages.slice(-3).map(m => m.content.slice(0, 100)).filter(Boolean);
                if (keyRequests.length > 0) {
                  summaryParts.push(`Recent requests: ${keyRequests.join("; ")}`);
                }
              }
              
              if (assistantMessages.length > 0) {
                summaryParts.push(`Completed ${assistantMessages.length} response cycles`);
              }
              
              summaryContent = `Summary of ${removed.length} earlier messages: ${summaryParts.join(". ")}.`;
            }
            
            agent.messages = [
              ...sys,
              ...(summaryContent
                ? [
                    {
                      id: Math.random().toString(36).slice(2, 10),
                      role: "user" as const,
                       content: `[Compact: ${removed.length} messages summarized. ${summaryContent}]`,
                      timestamp: Date.now(),
                    },
                  ]
                : []),
              ...kept,
            ];
            setMessages([...agent.messages]);
            return;
          }
          case "connect":
            setOverlay("connect");
            return;
          case "auto": {
            const task = args.trim();
            if (task) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "Autonomous mode enabled. You may iterate tools freely to complete the task.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              // Strip /auto and run the task
              await agent.run(task);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "Usage: /auto [task description] — runs the agent in autonomous mode.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "reset-rounds":
            agent.roundCounter = 0;
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content: "Round counter reset to 0.",
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          case "todo":
            if (args) {
              agent.addTodo(args);
            } else {
              setShowTodos((s) => !s);
            }
            return;
          case "skill": {
            const skills = loadSkills();
            const content =
              skills.size > 0
                ? `Available skills: ${Array.from(skills.keys()).join(", ")}`
                : "No skills loaded.";
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content,
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          }
          case "save":
            handleSave();
            return;
          case "load":
            setSessions(loadSessions());
            setOverlay("history");
            return;
          case "cd": {
            let target = args.trim();
            if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
              target = target.slice(1, -1).trim();
            }
            if (!target) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Current workspace: ${agent.cfg.workspace}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              return;
            }
            
            // Use the change_workspace tool instead of direct reconfigure
            // This ensures consistent workspace handling across all tools
            const changeWorkspaceTool = tools.find(t => t.name === "change_workspace");
            if (!changeWorkspaceTool) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `change_workspace tool not found`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              return;
            }
            const toolResult = agent.cfg.allowedPaths?.length 
              ? changeWorkspaceTool.execute({ path: target }, agent.cfg.workspace, agent.cfg)
              : changeWorkspaceTool.execute({ path: target }, agent.cfg.workspace);
            
            try {
              const result = JSON.parse(toolResult);
              if (result.ok && result.workspace) {
                agent.reconfigure({ workspace: result.workspace });
                agent.todos = loadTodos(result.workspace);
                setTodos([...agent.todos]);
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "system",
                  content: `Workspace changed to ${result.workspace}`,
                  timestamp: Date.now(),
                });
                setMessages([...agent.messages]);
                return;
              } else {
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "system",
                  content: `Failed to change workspace: ${result.error || 'Unknown error'}`,
                  timestamp: Date.now(),
                });
                setMessages([...agent.messages]);
                return;
              }
            } catch (parseError) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Failed to parse workspace change result: ${toolResult}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              return;
            }
          }

          case "theme": {
            const tname = args.trim() || "";
            const next = THEMES[tname];
            if (next) {
              setTheme(next);
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Theme set to ${next.name}.`,
                timestamp: Date.now(),
              });
            } else {
              const names = Object.keys(THEMES).join(", ");
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Available themes: ${names}`,
                timestamp: Date.now(),
              });
            }
            setMessages([...agent.messages]);
            return;
          }
          case "export": {
            if (!agent) return;
            try {
              const filePath = exportToMarkdown(agent.messages, args || undefined);
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Chat exported to ${filePath}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } catch (err) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Failed to export chat: ${err}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "skills":
            setOverlay("skills");
            return;
          case "reload": {
            // Reload skills
            const loadedSkills = loadSkills();
            setSkills(loadedSkills);
            setSkillCommands(getSkillCommands(loadedSkills));
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content: `Skills reloaded. ${loadedSkills.size} skills loaded.`,
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          }
          case "sessions": {
            // List available sessions
            const sessions = loadSessions().filter((s) => !s.id.startsWith("autosave-"));
            if (sessions.length > 0) {
              const list = sessions
                .map((s) => `${new Date(s.updatedAt).toLocaleDateString()} - ${s.id}`)
                .join("\n");
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Available sessions:\n${list}\n\nTo resume: /resume [id]`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "No saved sessions found. Your current session will be auto-saved on exit.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "new": {
            // Start a new session - clear messages and todos
            agent.messages = [];
            agent.todos = [];
            setMessages([]);
            setTodos([]);
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content: "Started a new session. Previous conversation cleared.",
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          }
          case "delete-session": {
            // Delete a saved session
            const id = args?.trim();
            if (!id) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "Usage: /delete-session [id]. List sessions with /sessions.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              return;
            }
            const sessions = loadSessions();
            const sessionExists = sessions.some((s) => s.id === id);
            if (sessionExists) {
              deleteSession(id);
              setSessions(loadSessions());
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Session '${id}' deleted.`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Session '${id}' not found. Use /sessions to list available sessions.`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "resume": {
            // Resume latest or specific session
            const session = resumeSession(args?.trim());
            if (session) {
              agent.messages = session.messages;
              agent.todos = session.todos;
              setMessages([...agent.messages]);
              setTodos([...agent.todos]);
              setCurrentSessionId(session.id);
              agent.onUpdate?.();
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Resumed session: ${session.id} (${session.messages.length} messages)`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: args?.trim() ? `Session '${args.trim()}' not found.` : "No sessions to resume.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "rename": {
            handleRename(args || "");
            return;
          }
          case "copy": {
            // Copy message content to clipboard by message ID
            const targetId = args?.trim();
            if (!targetId) {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "Usage: /copy [message-id]. Use /copy with a message ID to copy its content to clipboard.",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
              return;
            }

            // Find message by ID (full or partial match)
            const message = agent.messages.find(
              (m) => m.id.includes(targetId) || m.id === targetId
            );

            if (message) {
              const success = copyToClipboard(message.content);
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: success
                  ? `Copied message ${message.id.slice(0, 8)} to clipboard.`
                  : `Failed to copy to clipboard. Content:\n${message.content.slice(0, 500)}${message.content.length > 500 ? "..." : ""}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Message with ID '${targetId}' not found. Use the full message ID or a unique partial match.`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "todos": {
            // Show current todos in chat
            if (todos.length > 0) {
              const todoList = todos
                .map((t) => `${t.done ? "✓" : "✗"} ${t.id}: ${t.text}`)
                .join("\n");
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Current Todos:\n${todoList}\n\nUse /todo [text] to add, /clear-todos to remove all.`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            } else {
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: "No todos. Add one with /todo [description].",
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
            return;
          }
          case "clear-todos": {
            // Clear all todos
            agent.todos = [];
            setTodos([]);
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content: "All todos cleared.",
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          }
          case "exit":
            // Auto-save before exiting
            if (agent) {
              autoSaveSession(agent.messages, agent.todos, cfg.workspace);
            }
            process.exit(0);
            return;
          default: {
            // Handle /skill:name format
            if (command.startsWith("skill:")) {
              const skillName = command.replace(/^skill:/, "");
              const skill = getSkill(skillName) || skills.get(skillName);
              if (skill) {
                // Inject skill prompt into agent context
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "system",
                  content: `Skill activated: ${skill.name}\n${skill.prompt}`,
                  timestamp: Date.now(),
                });
                
                // Build welcome message with options
                let welcomeText = `**Skill Loaded: ${skill.name}**\n\n`;
                
                if (skill.welcomeMessage) {
                  welcomeText += `${skill.welcomeMessage}\n\n`;
                } else {
                  welcomeText += `${skill.description}\n\n`;
                }
                
                if (skill.options && skill.options.length > 0) {
                  welcomeText += "**Available Options:**\n";
                  skill.options.forEach((opt, idx) => {
                    welcomeText += `${idx + 1}. **${opt.label}**`;
                    if (opt.description) {
                      welcomeText += ` - ${opt.description}`;
                    }
                    welcomeText += `\n`;
                  });
                  welcomeText += `\nType the number or describe what you'd like to do:`;
                } else {
                  welcomeText += `What would you like to do with this skill?`;
                }
                
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "assistant",
                  content: welcomeText,
                  timestamp: Date.now(),
                });
                
                setMessages([...agent.messages]);
                return;
              } else {
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "system",
                  content: `Skill "${skillName}" not found. Use /skills to see available skills.`,
                  timestamp: Date.now(),
                });
                setMessages([...agent.messages]);
                return;
              }
            }

            // Handle /skills [name] or /skill [name]
            if ((command === "skills" || command === "skill") && args) {
              const skillName = args.trim().replace(/^skill:/, "");
              const skill = getSkill(skillName) || skills.get(skillName);
              if (skill) {
                // Inject skill prompt into agent context
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "system",
                  content: `Skill activated: ${skill.name}\n${skill.prompt}`,
                  timestamp: Date.now(),
                });
                
                // Build welcome message with options
                let welcomeText = `**Skill Loaded: ${skill.name}**\n\n`;
                
                if (skill.welcomeMessage) {
                  welcomeText += `${skill.welcomeMessage}\n\n`;
                } else {
                  welcomeText += `${skill.description}\n\n`;
                }
                
                if (skill.options && skill.options.length > 0) {
                  welcomeText += "**Available Options:**\n";
                  skill.options.forEach((opt, idx) => {
                    welcomeText += `${idx + 1}. **${opt.label}**`;
                    if (opt.description) {
                      welcomeText += ` - ${opt.description}`;
                    }
                    welcomeText += `\n`;
                  });
                  welcomeText += `\nType the number or describe what you'd like to do:`;
                } else {
                  welcomeText += `What would you like to do with this skill?`;
                }
                
                agent.messages.push({
                  id: Math.random().toString(36).slice(2, 10),
                  role: "assistant",
                  content: welcomeText,
                  timestamp: Date.now(),
                });
                
                setMessages([...agent.messages]);
                return;
              }
            }

            // Check if it's a skill command
            const skillName = args.trim().replace(/^skill:/, "");
            const skill = getSkill(skillName) || skills.get(skillName);
            if (skill) {
              // Inject skill prompt into agent context
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Skill activated: ${skill.name}\n${skill.prompt}`,
                timestamp: Date.now(),
              });
              
              // Build welcome message with options
              let welcomeText = `**Skill Loaded: ${skill.name}**\n\n`;
              
              if (skill.welcomeMessage) {
                welcomeText += `${skill.welcomeMessage}\n\n`;
              } else {
                welcomeText += `${skill.description}\n\n`;
              }
              
              if (skill.options && skill.options.length > 0) {
                welcomeText += "**Available Options:**\n";
                skill.options.forEach((opt, idx) => {
                  welcomeText += `${idx + 1}. **${opt.label}**`;
                  if (opt.description) {
                    welcomeText += ` - ${opt.description}`;
                  }
                  welcomeText += `\n`;
                });
                welcomeText += `\nType the number or describe what you'd like to do:`;
              } else {
                welcomeText += `What would you like to do with this skill?`;
              }
              
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "assistant",
                content: welcomeText,
                timestamp: Date.now(),
              });
              
              setMessages([...agent.messages]);
              return;
            }

            // Unknown command
            agent.messages.push({
              id: Math.random().toString(36).slice(2, 10),
              role: "system",
              content: `Unknown command: /${command}. Type /help for available commands.`,
              timestamp: Date.now(),
            });
            setMessages([...agent.messages]);
            return;
          }
        }
      }

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // Check if auto-compaction is needed before sending
      if (agent) {
        checkAndAutoCompact(agent, setMessages);
      }

      try {
        await agent.run(text, signal);
      } catch (err) {
        console.error("Error running agent:", err);
      }
    },
    [state, handleSave]
  );

  if (overlay === "help") {
    return (
      <ErrorBoundary theme={theme}>
        <HelpOverlay theme={theme} onClose={() => setOverlay(null)} />
      </ErrorBoundary>
    );
  }
  if (overlay === "history") {
    return (
      <ErrorBoundary theme={theme}>
        <HistoryOverlay
          theme={theme}
          sessions={sessions}
          onLoad={handleLoad}
          onDelete={handleDeleteSession}
          onClose={() => setOverlay(null)}
        />
      </ErrorBoundary>
    );
  }

  if (overlay === "skills") {
    return (
      <ErrorBoundary theme={theme}>
        <SkillsOverlay
          theme={theme}
          onClose={() => {
            setOverlay(null);
            // Refresh skills after closing
            setSkills(loadSkills());
            setSkillCommands(getSkillCommands(loadSkills()));
            // Also call the global refresh handler to ensure consistency
            if (typeof (globalThis as any).__refreshSkills === 'function') {
              (globalThis as any).__refreshSkills();
            }
          }}
          onSkillSelect={(skillName) => {
            setOverlay(null);
            // Handle skill selection - inject skill prompt into chat
            const skill = getSkill(skillName);
            if (skill && agentRef.current) {
              const agent = agentRef.current;
              
              // Inject skill prompt into agent context
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Skill activated: ${skill.name}\n${skill.prompt}`,
                timestamp: Date.now(),
              });
              
              // Build welcome message with options
              let welcomeText = `**Skill Loaded: ${skill.name}**\n\n`;
              
              if (skill.welcomeMessage) {
                welcomeText += `${skill.welcomeMessage}\n\n`;
              } else {
                welcomeText += `${skill.description}\n\n`;
              }
              
              if (skill.options && skill.options.length > 0) {
                welcomeText += "**Available Options:**\n";
                skill.options.forEach((opt, idx) => {
                  welcomeText += `${idx + 1}. **${opt.label}**`;
                  if (opt.description) {
                    welcomeText += ` - ${opt.description}`;
                  }
                  welcomeText += `\n`;
                });
                welcomeText += `\nType the number or describe what you'd like to do:`;
              } else {
                welcomeText += `What would you like to do with this skill?`;
              }
              
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "assistant",
                content: welcomeText,
                timestamp: Date.now(),
              });
              
              setMessages([...agent.messages]);
            }
          }}
        />
      </ErrorBoundary>
    );
  }

  if (overlay === "connect") {
    return (
      <ErrorBoundary theme={theme}>
        <ConnectOverlay
          theme={theme}
          onClose={() => setOverlay(null)}
          onSelect={(provider, model, apiKey) => {
            const agent = agentRef.current;
            if (agent) {
              const newConfig: Partial<Config> = {
                baseURL: getProviderBaseURL(provider) || agent.cfg.baseURL,
                model: model.id,
              };
              if (apiKey) {
                newConfig.apiKey = apiKey;
              } else if (provider.isLocal) {
                // Local providers don't need real keys; send a dummy so the
                // SDK doesn't forward a stale remote key.
                newConfig.apiKey = "lm-studio";
              }
              agent.reconfigure(newConfig);
              agent.messages.push({
                id: Math.random().toString(36).slice(2, 10),
                role: "system",
                content: `Connected to ${provider.name} using model: ${model.name} (${model.id})${provider.isLocal ? " [Local]" : ""}`,
                timestamp: Date.now(),
              });
              setMessages([...agent.messages]);
            }
          }}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary theme={theme}>
      <box flexDirection="column" flexGrow={1}>
        <StatusBar
          state={state}
          model={agentRef.current?.cfg.model || ""}
          todoCount={todos.length}
          currentTool={currentTool}
          lastUsage={lastUsage}
          totalUsage={totalUsage}
          elapsedMs={elapsedMs}
          roundCounter={agentRef.current?.roundCounter}
          maxRounds={agentRef.current?.maxRounds}
          theme={theme}
          mouseEnabled={mouseEnabled}
        />

        <box flexDirection="row" flexGrow={1}>
          {showTodos && (
            <TodoSidebar
              theme={theme}
              todos={todos}
              onToggle={(id) => {
                const agent = agentRef.current;
                if (agent) agent.toggleTodo(id);
              }}
              onDelete={(id) => {
                const agent = agentRef.current;
                if (agent) agent.removeTodo(id);
              }}
              onClose={() => setShowTodos(false)}
            />
          )}

          <ChatScreen
            theme={theme}
            messages={messages}
            toolResults={toolResults}
            state={state}
            model={agentRef.current?.cfg.model || ""}
            todoCount={todos.length}
            elapsedMs={elapsedMs}
            currentTool={currentTool}
            lastUsage={lastUsage}
            totalUsage={totalUsage}
            onSubmit={handleSubmit}
            paginated={paginated}
            page={page}
            totalPages={paginated ? Math.ceil(messages.length / MESSAGES_PER_PAGE) : 1}
            onPageChange={setPage}
            selectedMessageIndex={selectedMessageIndex}
          />
        </box>
      </box>
    </ErrorBoundary>
  );
}
