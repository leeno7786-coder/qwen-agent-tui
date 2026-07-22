import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
/** @jsxImportSource @opentui/react */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useKeyboard } from '@opentui/react';
import { loadSkills, saveSkill, deleteSkill, toggleSkill, getSkillCommands, saveSkillConfig, getSkillConfig, } from '../skills.js';
export const BUILTIN_COMMANDS = [
    { name: '/new', description: 'Start a new session (clear all messages and todos)' },
    { name: '/plan', description: 'Toggle plan mode. Usage: /plan [on|off|view|clear]' },
    { name: '/reload', description: 'Reload configuration' },
    { name: '/sessions', description: 'List saved sessions' },
    { name: '/resume', description: 'Resume latest or specific session. Usage: /resume [id]' },
    { name: '/settings', description: 'Open settings' },
    { name: '/skills', description: 'Manage skills (F8)' },
    { name: '/unload', description: 'Unload a skill. Usage: /unload [name]' },
    { name: '/skill-load', description: 'Load a skill by name. Usage: /skill-load [name]' },
    { name: '/help', description: 'Show help (F1)' },
    { name: '/clear', description: 'Clear chat (F2)' },
    { name: '/compact', description: 'Compact conversation' },
    { name: '/auto', description: 'Autonomous mode (F3)' },
    { name: '/todo', description: 'Todo sidebar (F4)' },
    { name: '/save', description: 'Save session (F5)' },
    { name: '/load', description: 'Load session (F6)' },
    { name: '/cd', description: 'Change tool workspace. Usage: /cd [path]' },
    { name: '/allow', description: 'Approve extra tool access. Usage: /allow [path]' },
    { name: '/export', description: 'Export chat to markdown' },
    { name: '/theme', description: 'Switch theme' },
    { name: '/exit', description: 'Quit (F10)' },
];
export function SkillsOverlay({ theme, onClose, onSkillSelect, skills: propSkills, onSkillsChange: _onSkillsChange, }) {
    const [selected, setSelected] = useState(0);
    const scrollRef = useRef(null);
    const [mode, setMode] = useState('list');
    const [newSkillName, setNewSkillName] = useState('');
    const [newSkillDesc, setNewSkillDesc] = useState('');
    const [newSkillPrompt, setNewSkillPrompt] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    const [selectedSkill, setSelectedSkill] = useState(null);
    const [skillConfig, setSkillConfig] = useState({});
    const [message, setMessage] = useState(null);
    const [installUrl, setInstallUrl] = useState('');
    const [installing, setInstalling] = useState(false);
    // Load skill config on mount to apply user preferences
    useEffect(() => {
        const config = getSkillConfig();
        // Filter out undefined values (shouldn't happen but be safe)
        const filteredConfig = {};
        for (const [key, value] of Object.entries(config)) {
            if (value !== undefined) {
                filteredConfig[key] = value;
            }
        }
        setSkillConfig(filteredConfig);
    }, []);
    // Use passed skills or load fresh skills (refresh on each render to catch changes)
    const skills = propSkills || useMemo(() => loadSkills(), []);
    const skillCommands = useMemo(() => getSkillCommands(skills), [skills]);
    const items = useMemo(() => {
        if (mode === 'create') {
            return [
                { type: 'header', text: 'Create New Skill' },
                { type: 'text', text: `Name: ${newSkillName}` },
                { type: 'text', text: `Description: ${newSkillDesc}` },
                {
                    type: 'text',
                    text: `Prompt: ${newSkillPrompt.slice(0, 60)}${newSkillPrompt.length > 60 ? '...' : ''}`,
                },
                { type: 'divider' },
                { type: 'action', text: creating ? 'Creating...' : 'Create Skill', action: 'create' },
                { type: 'action', text: 'Cancel', action: 'cancel' },
            ];
        }
        if (mode === 'install') {
            return [
                { type: 'header', text: 'Install Skill from URL' },
                { type: 'text', text: installUrl || '(enter skill JSON URL below)' },
                { type: 'divider' },
                { type: 'action', text: installing ? 'Installing...' : 'Install', action: 'doInstall' },
                { type: 'action', text: 'Cancel', action: 'cancel' },
            ];
        }
        if (mode === 'detail' && selectedSkill) {
            const config = skillConfig[selectedSkill.name] !== undefined;
            const triggers = selectedSkill.triggers?.length
                ? selectedSkill.triggers.slice(0, 5).join(', ') +
                    (selectedSkill.triggers.length > 5 ? '...' : '')
                : 'None';
            const sourceIcon = selectedSkill.source === 'skilli.md' ? '📄' : '📋';
            const desc = selectedSkill.description || 'No description';
            return [
                { type: 'header', text: selectedSkill.name },
                { type: 'text', text: desc },
                {
                    type: 'text',
                    text: `${sourceIcon} ${selectedSkill.source || 'unknown'} ${selectedSkill.sourcePath ? `(${selectedSkill.sourcePath})` : ''}`,
                },
                { type: 'text', text: `Version: ${selectedSkill.version || '1.0.0'}` },
                { type: 'text', text: `Author: ${selectedSkill.author || 'N/A'}` },
                { type: 'text', text: `State: ${selectedSkill.enabled ? '✅ Enabled' : '⏸ Disabled'}` },
                { type: 'text', text: `Tools: ${selectedSkill.tools?.join(', ') || 'None'}` },
                { type: 'text', text: `Triggers: ${triggers}` },
                { type: 'divider' },
                { type: 'action', text: 'Activate Skill', action: 'activate' },
                {
                    type: 'action',
                    text: config ? 'Save Config to File' : 'Load Config from File',
                    action: 'saveConfig',
                },
                { type: 'action', text: selectedSkill.enabled ? 'Disable' : 'Enable', action: 'toggle' },
                { type: 'action', text: 'Delete', action: 'delete' },
                { type: 'action', text: 'Back', action: 'back' },
            ];
        }
        // List mode
        const itemsList = [];
        itemsList.push({ type: 'header', text: `Available Skills (${skills.size})` });
        itemsList.push({ type: 'text', text: 'Skills auto-load when user input matches triggers.' });
        if (skills.size === 0) {
            itemsList.push({ type: 'text', text: 'No skills found. Create your first skill below!' });
            itemsList.push({ type: 'divider' });
            itemsList.push({ type: 'action', text: 'Create Your First Skill', action: 'new' });
            itemsList.push({ type: 'text', text: '→ Get started with custom agent capabilities' });
        }
        else {
            const sortedSkills = Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name));
            sortedSkills.forEach((skill) => {
                const cmd = skillCommands.find((c) => c.skillName === skill.name);
                const sourceIcon = skill.source === 'skilli.md' ? '📄' : '📋';
                const triggerHint = skill.triggers?.length
                    ? ` [${skill.triggers.slice(0, 2).join(', ')}${skill.triggers.length > 2 ? '...' : ''}]`
                    : '';
                itemsList.push({
                    type: 'skill',
                    text: `${skill.enabled ? '✓' : '✗'} ${sourceIcon} ${skill.name}${triggerHint}`,
                    skill,
                    command: cmd,
                });
            });
        }
        itemsList.push({ type: 'divider' });
        itemsList.push({ type: 'action', text: 'Create New Skill', action: 'new' });
        itemsList.push({ type: 'text', text: '→ Start from scratch with guided creation' });
        itemsList.push({ type: 'action', text: 'Install Skill from URL', action: 'install' });
        itemsList.push({ type: 'action', text: 'View All Commands', action: 'commands' });
        itemsList.push({ type: 'action', text: 'Close', action: 'close' });
        return itemsList;
    }, [
        mode,
        skills,
        skillCommands,
        newSkillName,
        newSkillDesc,
        newSkillPrompt,
        creating,
        selectedSkill,
    ]);
    const commandItems = useMemo(() => {
        const list = [];
        list.push({ type: 'header', text: 'All Available Commands' });
        list.push({ type: 'header', text: 'Built-in Commands' });
        BUILTIN_COMMANDS.forEach((cmd) => {
            list.push({ type: 'text', text: `  ${cmd.name.padEnd(25)} ${cmd.description}` });
        });
        list.push({ type: 'divider' });
        list.push({ type: 'header', text: 'Skill Commands' });
        if (skillCommands.length > 0) {
            skillCommands.forEach((cmd) => {
                list.push({ type: 'text', text: `  ${cmd.name.padEnd(25)} ${cmd.description}` });
            });
        }
        else {
            list.push({ type: 'text', text: '  No skill commands available' });
        }
        return list;
    }, [skillCommands]);
    const handleInstallSkill = useCallback(async () => {
        if (!installUrl.trim()) {
            setError('Please enter a skill URL');
            return;
        }
        setInstalling(true);
        setError(null);
        try {
            const res = await fetch(installUrl.trim());
            if (!res.ok)
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const skill = (await res.json());
            if (!skill.name || !skill.prompt) {
                throw new Error("Skill JSON must contain 'name' and 'prompt' fields");
            }
            if (!skill.description)
                skill.description = '';
            if (!skill.tools)
                skill.tools = [];
            saveSkill(skill);
            setMessage(`Installed skill: ${skill.name}`);
            if (typeof globalThis.__refreshSkills === 'function') {
                globalThis.__refreshSkills?.();
            }
            setMode('list');
            setInstallUrl('');
        }
        catch (e) {
            setError(`Install failed: ${e.message}`);
        }
        finally {
            setInstalling(false);
        }
    }, [installUrl]);
    const handleCreateSkill = useCallback(() => {
        if (!newSkillName.trim()) {
            setError('Skill name is required');
            return;
        }
        if (!newSkillDesc.trim()) {
            setError('Description is required');
            return;
        }
        setCreating(true);
        setError(null);
        try {
            // Generate a command name from the skill name
            const commandName = `skill:${newSkillName
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '')}`;
            // Generate a smart default prompt if none provided
            const defaultPrompt = newSkillPrompt.trim() ||
                `You are now an expert in ${newSkillName.trim()}. ${newSkillDesc.trim()}.\n\n` +
                    `When this skill is active:\n` +
                    `- Use precise, technical language\n` +
                    `- Break down complex tasks into steps\n` +
                    `- Leverage available tools effectively\n` +
                    `- Explain your reasoning clearly`;
            const skill = {
                name: newSkillName.trim(),
                description: newSkillDesc.trim(),
                prompt: defaultPrompt,
                tools: [],
                enabled: true,
                command: commandName,
                version: '1.0.0',
                author: 'user',
                tags: [],
            };
            saveSkill(skill);
            if (onSkillSelect) {
                onSkillSelect(skill.name);
            }
            setMode('list');
            setNewSkillName('');
            setNewSkillDesc('');
            setNewSkillPrompt('');
            // Notify main app to refresh skills
            if (typeof globalThis.__refreshSkills === 'function') {
                globalThis.__refreshSkills?.();
            }
        }
        catch (e) {
            setError(`Failed to create skill: ${e.message}`);
        }
        finally {
            setCreating(false);
        }
    }, [newSkillName, newSkillDesc, newSkillPrompt, onSkillSelect]);
    const handleToggleSkill = useCallback(() => {
        if (!selectedSkill)
            return;
        toggleSkill(selectedSkill.name);
        // Refresh the skills list to reflect the change
        setMode('list');
        setSelectedSkill(null);
        // Notify main app to refresh skills
        const refreshSkills = globalThis;
        if (typeof refreshSkills.__refreshSkills === 'function') {
            refreshSkills.__refreshSkills();
        }
    }, [selectedSkill]);
    const handleDeleteSkill = useCallback(() => {
        if (!selectedSkill)
            return;
        deleteSkill(selectedSkill.name);
        setMode('list');
        const refreshSkills = globalThis;
        if (typeof refreshSkills.__refreshSkills === 'function') {
            refreshSkills.__refreshSkills();
        }
    }, [selectedSkill]);
    const handleSaveConfig = useCallback(() => {
        if (!selectedSkill)
            return;
        // Get current config and update with this skill's state
        const currentConfig = getSkillConfig();
        const enabled = selectedSkill.enabled === undefined ? true : selectedSkill.enabled;
        const updatedConfig = {
            ...currentConfig,
            [selectedSkill.name]: enabled,
        };
        saveSkillConfig(updatedConfig);
        // Update local state
        setSkillConfig(updatedConfig);
        // Show inline success message instead of alert()
        setMessage(`Skill config saved for ${selectedSkill.name}: ${selectedSkill.enabled ? 'Enabled' : 'Disabled'}`);
        setTimeout(() => setMessage(null), 2000);
    }, [selectedSkill]);
    const handleSelect = useCallback((index) => {
        const item = mode === 'commands' ? commandItems[index] : items[index];
        if (!item)
            return;
        if (item.type === 'skill' && item.skill && mode === 'list') {
            setSelectedSkill(item.skill);
            setMode('detail');
            setSelected(7); // Navigate to first action item (Activate Skill)
        }
        else if (item.type === 'action') {
            switch (item.action) {
                case 'activate':
                    if (onSkillSelect && selectedSkill) {
                        onSkillSelect(selectedSkill.name);
                    }
                    break;
                case 'create':
                    handleCreateSkill();
                    break;
                case 'doInstall':
                    handleInstallSkill();
                    break;
                case 'install':
                    setMode('install');
                    setSelected(0);
                    break;
                case 'cancel':
                    setMode('list');
                    setNewSkillName('');
                    setNewSkillDesc('');
                    setNewSkillPrompt('');
                    setInstallUrl('');
                    setError(null);
                    break;
                case 'new':
                    setMode('create');
                    setSelected(0);
                    break;
                case 'toggle':
                    handleToggleSkill();
                    break;
                case 'delete':
                    handleDeleteSkill();
                    break;
                case 'saveConfig':
                    handleSaveConfig();
                    break;
                case 'back':
                    setMode('list');
                    break;
                case 'commands':
                    setMode('commands');
                    setSelected(0);
                    break;
                case 'close':
                    onClose();
                    break;
            }
        }
    }, [
        items,
        commandItems,
        mode,
        selectedSkill,
        handleCreateSkill,
        handleToggleSkill,
        handleDeleteSkill,
        handleSaveConfig,
        handleInstallSkill,
        onSkillSelect,
        onClose,
    ]);
    useKeyboard((keyEvent) => {
        if (keyEvent.name === 'escape' || keyEvent.name === 'Escape') {
            if (mode === 'create' || mode === 'detail' || mode === 'commands' || mode === 'install') {
                setMode('list');
                setSelected(0);
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else {
                onClose();
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
        if (keyEvent.name === 'return' || keyEvent.name === 'Enter') {
            handleSelect(selected);
            keyEvent.preventDefault?.();
            keyEvent.stopPropagation?.();
            return;
        }
        if (mode === 'create' || mode === 'install') {
            // Handle input modes - keyboard navigation is limited to actions
            if (keyEvent.name === 'up' || keyEvent.name === 'ArrowUp') {
                setSelected((s) => Math.max(0, s - 1));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else if (keyEvent.name === 'down' || keyEvent.name === 'ArrowDown') {
                setSelected((s) => Math.min(displayItems.length - 1, s + 1));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
        if (keyEvent.name === 'up' || keyEvent.name === 'ArrowUp') {
            setSelected((s) => Math.max(0, s - 1));
            keyEvent.preventDefault?.();
            keyEvent.stopPropagation?.();
        }
        else if (keyEvent.name === 'down' || keyEvent.name === 'ArrowDown') {
            const displayItems = mode === 'commands' ? commandItems : items;
            setSelected((s) => Math.min(displayItems.length - 1, s + 1));
            keyEvent.preventDefault?.();
            keyEvent.stopPropagation?.();
        }
    }, { release: false });
    const displayItems = mode === 'commands' ? commandItems : items;
    useEffect(() => {
        if (scrollRef.current && (mode === 'list' || mode === 'commands' || mode === 'detail')) {
            scrollRef.current.scrollChildIntoView(`skill-item-${selected}`);
        }
    }, [selected, displayItems.length, mode]);
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", borderStyle: "double", borderColor: theme.borderColor, backgroundColor: theme.bgPanel, children: [_jsxs("box", { flexDirection: "row", justifyContent: "space-between", paddingX: 2, paddingY: 1, flexShrink: 0, children: [_jsx("text", { fg: theme.headerFg, children: mode === 'create'
                            ? 'Create Skill'
                            : mode === 'install'
                                ? 'Install Skill'
                                : mode === 'detail'
                                    ? 'Skill Details'
                                    : mode === 'commands'
                                        ? 'All Commands'
                                        : `Skills (${skills.size})` }), _jsx("text", { fg: theme.mutedFg, children: "Esc to close" })] }), error && (_jsx("box", { paddingX: 2, paddingY: 0, children: _jsx("text", { fg: theme.errorFg, children: error }) })), message && (_jsx("box", { paddingX: 2, paddingY: 0, children: _jsx("text", { fg: theme.agentFg, children: message }) })), mode === 'create' ? (_jsxs("box", { flexDirection: "column", paddingX: 2, paddingY: 1, flexGrow: 1, minHeight: 0, overflow: "hidden", children: [_jsx("text", { fg: theme.mutedFg, marginBottom: 1, children: "Skills extend your agent's capabilities for specific domains or tasks. The model will automatically use this skill when relevant." }), _jsx("text", { fg: theme.headerFg, children: "Skill Name:" }), _jsx("text", { fg: theme.mutedFg, marginBottom: 0, children: "Short, descriptive name (e.g., \"azure-ai\", \"code-review\")" }), _jsx("input", { flexGrow: 0, value: newSkillName, onInput: setNewSkillName, placeholder: "e.g., azure-ai" }), _jsx("text", { fg: theme.headerFg, marginTop: 1, children: "Description:" }), _jsx("text", { fg: theme.mutedFg, marginBottom: 0, children: "Brief description of what this skill does" }), _jsx("input", { flexGrow: 0, value: newSkillDesc, onInput: setNewSkillDesc, placeholder: "e.g., Use for Azure AI Search, Speech, and OpenAI tasks" }), _jsx("text", { fg: theme.headerFg, marginTop: 1, children: "Custom Prompt (Optional):" }), _jsx("text", { fg: theme.mutedFg, marginBottom: 0, children: "How should the model behave when this skill is active?" }), _jsx("input", { flexGrow: 0, value: newSkillPrompt, onInput: setNewSkillPrompt, placeholder: "Leave blank for auto-generated prompt" }), _jsxs("box", { marginTop: 1, children: [_jsx("text", { fg: theme.headerFg, marginBottom: 0, children: "Examples:" }), _jsx("text", { fg: theme.mutedFg, children: "\u2022 azure-ai: Azure AI services (Search, Speech, OpenAI)" }), _jsx("text", { fg: theme.mutedFg, children: "\u2022 code-review: Code quality analysis and PR reviews" }), _jsx("text", { fg: theme.mutedFg, children: "\u2022 deployment: CI/CD pipelines and infrastructure automation" }), _jsx("text", { fg: theme.mutedFg, children: "\u2022 data-analysis: Data processing and visualization" })] }), error && (_jsx("text", { fg: theme.errorFg, marginTop: 1, children: error })), _jsx("text", { fg: theme.agentFg, marginTop: 2, children: "Press Enter to select \"Create Skill\" or \"Cancel\"" })] })) : mode === 'install' ? (_jsxs("box", { flexDirection: "column", paddingX: 2, paddingY: 1, flexGrow: 1, minHeight: 0, overflow: "hidden", children: [_jsx("text", { fg: theme.mutedFg, marginBottom: 1, children: "Install a skill from a remote JSON URL. The skill file must contain at least \"name\" and \"prompt\" fields." }), _jsx("text", { fg: theme.headerFg, children: "Skill JSON URL:" }), _jsx("text", { fg: theme.mutedFg, marginBottom: 0, children: "Raw URL to a skill.json file" }), _jsx("input", { flexGrow: 0, value: installUrl, onInput: setInstallUrl, placeholder: "https://raw.githubusercontent.com/.../skill.json" }), error && (_jsx("text", { fg: theme.errorFg, marginTop: 1, children: error })), _jsx("text", { fg: theme.agentFg, marginTop: 2, children: "Press Enter to select \"Install\" or \"Cancel\"" })] })) : (_jsx("scrollbox", { ref: scrollRef, flexGrow: 1, flexShrink: 1, minHeight: 0, flexDirection: "column", paddingX: 2, paddingY: 1, children: displayItems.map((item, i) => {
                    if (item.type === 'header') {
                        return (_jsx("text", { id: `skill-item-${i}`, fg: theme.headerFg, marginTop: i > 0 ? 1 : 0, children: item.text }, `h-${i}`));
                    }
                    if (item.type === 'divider') {
                        return (_jsx("box", { id: `skill-item-${i}`, height: 1, border: true, borderColor: theme.borderColor, marginY: 1 }, `d-${i}`));
                    }
                    if (item.type === 'text') {
                        return (_jsx("text", { id: `skill-item-${i}`, fg: theme.inputFg, children: item.text }, `t-${i}`));
                    }
                    if (item.type === 'skill' && item.skill) {
                        return (_jsxs("text", { id: `skill-item-${i}`, fg: i === selected ? theme.headerFg : theme.agentFg, bg: i === selected ? theme.bgSelected : undefined, children: [i === selected ? '> ' : '  ', item.text] }, `s-${i}`));
                    }
                    if (item.type === 'action') {
                        return (_jsxs("text", { id: `skill-item-${i}`, fg: i === selected ? theme.headerFg : theme.agentFg, bg: i === selected ? theme.bgSelected : undefined, marginTop: 1, children: [i === selected ? '> ' : '  ', item.text] }, `a-${i}`));
                    }
                    return null;
                }) }))] }));
}
