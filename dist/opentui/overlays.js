import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
/** @jsxImportSource @opentui/react */
import { useState, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
export function HelpOverlay({ theme, onClose }) {
    useKeyboard((keyEvent) => {
        if (keyEvent.name === 'escape' || keyEvent.name === 'Escape') {
            onClose();
        }
    });
    return (_jsxs("scrollbox", { flexDirection: "column", borderStyle: "double", borderColor: theme.borderColor, paddingX: 2, paddingY: 1, flexGrow: 1, minHeight: 0, backgroundColor: theme.bgPanel, children: [_jsx("text", { fg: theme.headerFg, children: "NanoAgent \u2014 Help & Reference" }), _jsx("text", { fg: theme.mutedFg, children: "Esc to close" }), _jsx("text", { children: " " }), _jsx("text", { fg: theme.userFg, children: "Commands:" }), _jsx("text", { fg: theme.agentFg, children: " /new Start a new session (clear all)" }), _jsx("text", { fg: theme.agentFg, children: " /clear Clear chat history" }), _jsx("text", { fg: theme.agentFg, children: " /compact Compact conversation context" }), _jsx("text", { fg: theme.agentFg, children: " /auto ... Autonomous subagent mode" }), _jsxs("text", { fg: theme.agentFg, children: [' ', "/config [show|set|reload] Show or edit configuration (.nanogent.json)"] }), _jsxs("text", { fg: theme.agentFg, children: [' ', "/set <key> <val> [--global] Quick-set config options (model, baseURL, etc)"] }), _jsx("text", { fg: theme.agentFg, children: " /todo Toggle todo sidebar (/todo add ...)" }), _jsx("text", { fg: theme.agentFg, children: " /skill List loaded skills" }), _jsx("text", { fg: theme.agentFg, children: " /skills Manage skills (F8) \u2014 create, enable, disable" }), _jsx("text", { fg: theme.agentFg, children: " /sessions List saved sessions" }), _jsx("text", { fg: theme.agentFg, children: " /resume [id] Resume latest or specific session" }), _jsx("text", { fg: theme.agentFg, children: " /rename [name] Rename current session" }), _jsx("text", { fg: theme.agentFg, children: " /copy [id] Copy message content to clipboard" }), _jsx("text", { fg: theme.agentFg, children: " /save [name] Save conversation" }), _jsx("text", { fg: theme.agentFg, children: " /load Load a saved conversation" }), _jsx("text", { fg: theme.agentFg, children: " /reload Reload config, skills, and LM Studio metadata" }), _jsx("text", { fg: theme.agentFg, children: " /theme [name] Switch color theme" }), _jsxs("text", { fg: theme.agentFg, children: [' ', "/connect Connect provider \u2014 browse runtimes, enter API keys, select models"] }), _jsx("text", { fg: theme.agentFg, children: " /doctor Health check (config + LM Studio / local runtimes)" }), _jsx("text", { fg: theme.agentFg, children: " /models List local models, context, load state" }), _jsx("text", { fg: theme.agentFg, children: " /graph [sub] Memory graph \u2014 build|stats|report" }), _jsx("text", { fg: theme.agentFg, children: " /mcp List connected Model Context Protocol servers" }), _jsxs("text", { fg: theme.agentFg, children: [' ', "/mcp-add <name> <local|remote> <cmd|url> Add MCP server"] }), _jsx("text", { fg: theme.agentFg, children: " /mcp-remove <name> Remove MCP server" }), _jsx("text", { fg: theme.agentFg, children: " /cd [path] Change workspace directory" }), _jsx("text", { fg: theme.agentFg, children: " /allow [path] Approve extra tool access outside workspace" }), _jsx("text", { fg: theme.agentFg, children: " /export Export chat to markdown file" }), _jsx("text", { fg: theme.agentFg, children: " /exit Quit (auto-saves session)" }), _jsx("text", { children: " " }), _jsx("text", { fg: theme.userFg, children: "Shortcuts:" }), _jsx("text", { fg: theme.mutedFg, children: " F1 Help" }), _jsx("text", { fg: theme.mutedFg, children: " F2 Clear chat" }), _jsx("text", { fg: theme.mutedFg, children: " F3 Prefill /auto" }), _jsx("text", { fg: theme.mutedFg, children: " F4 Todo sidebar" }), _jsx("text", { fg: theme.mutedFg, children: " F5 Save session" }), _jsx("text", { fg: theme.mutedFg, children: " F6 Load session" }), _jsx("text", { fg: theme.mutedFg, children: " F7 Toggle mouse capture" }), _jsx("text", { fg: theme.mutedFg, children: " F8 Skills overlay" }), _jsx("text", { fg: theme.mutedFg, children: " F9 Cycle theme" }), _jsx("text", { fg: theme.mutedFg, children: " F10 Exit" }), _jsx("text", { children: " " }), _jsx("text", { fg: theme.userFg, children: "CLI Execution (headless or scripts):" }), _jsx("text", { fg: theme.mutedFg, children: " nanogent Interactive TUI (default)" }), _jsx("text", { fg: theme.mutedFg, children: " nanogent run -p \"task\" -w . Run single task" }), _jsx("text", { fg: theme.mutedFg, children: " nanogent doctor --json Health check report" }), _jsx("text", { fg: theme.mutedFg, children: " nanogent models List available local/remote models" }), _jsx("text", { children: " " }), _jsx("text", { fg: theme.userFg, children: "Input:" }), _jsx("text", { fg: theme.mutedFg, children: " Shift+Enter Multi-line input" }), _jsx("text", { fg: theme.mutedFg, children: " Ctrl+\u2191/\u2193 Select message" }), _jsx("text", { fg: theme.mutedFg, children: " Ctrl+C Copy selected message" }), _jsx("text", { children: " " }), _jsx("text", { fg: theme.userFg, children: "Copying text:" }), _jsx("text", { fg: theme.mutedFg, children: " Hold Shift + drag to select and copy" }), _jsx("text", { fg: theme.mutedFg, children: " Or press F7 to disable mouse capture, then drag normally" })] }));
}
export function HistoryOverlay({ theme, sessions, onLoad, onDelete, onClose, }) {
    const [selected, setSelected] = useState(0);
    const scrollRef = useRef(null);
    useEffect(() => {
        scrollRef.current?.scrollChildIntoView(`session-${selected}`);
    }, [selected]);
    useKeyboard((keyEvent) => {
        if (keyEvent.name === 'escape' || keyEvent.name === 'Escape') {
            onClose();
            return;
        }
        if (keyEvent.name === 'up' || keyEvent.name === 'ArrowUp') {
            setSelected((s) => Math.max(0, s - 1));
            return;
        }
        if (keyEvent.name === 'down' || keyEvent.name === 'ArrowDown') {
            setSelected((s) => Math.min(sessions.length - 1, s + 1));
            return;
        }
        if (keyEvent.name === 'return' || keyEvent.name === 'Enter') {
            const sess = sessions[selected];
            if (sess)
                onLoad(sess);
            return;
        }
        if (keyEvent.name === 'delete' || keyEvent.name === 'Delete') {
            const sess = sessions[selected];
            if (sess) {
                onDelete(sess.id);
                setSelected((s) => Math.max(0, s - 1));
            }
        }
    });
    return (_jsxs("scrollbox", { ref: scrollRef, flexDirection: "column", borderStyle: "double", borderColor: theme.borderColor, paddingX: 2, paddingY: 1, flexGrow: 1, minHeight: 0, backgroundColor: theme.bgPanel, children: [_jsx("text", { fg: theme.headerFg, children: "Conversation History" }), _jsx("text", { fg: theme.mutedFg, children: "\u2191\u2193 Navigate \u00B7 Enter Load \u00B7 Del Delete \u00B7 Esc Close" }), _jsx("text", { children: " " }), sessions.length === 0 ? (_jsx("text", { fg: theme.mutedFg, children: "No saved sessions." })) : (sessions.map((sess, i) => {
                const isSel = i === selected;
                const firstUser = sess.messages.find((m) => m.role === 'user');
                const preview = firstUser ? firstUser.content.slice(0, 40).replace(/\n/g, ' ') : 'Empty';
                const date = new Date(sess.updatedAt).toLocaleString();
                return (_jsxs("text", { id: `session-${i}`, fg: isSel ? theme.headerFg : theme.mutedFg, bg: isSel ? theme.bgSelected : undefined, children: [isSel ? '> ' : '  ', date, " (", sess.messages.length, ") ", preview] }, sess.id));
            }))] }));
}
