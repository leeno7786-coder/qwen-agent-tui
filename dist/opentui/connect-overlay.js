import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
/** @jsxImportSource @opentui/react */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { RUNTIME_PROVIDERS, getProviderBaseURL, providerRequiresAuth, getApiKeyEnvVar, fetchLocalModels, fetchOpenRouterModels, checkRuntimeHealth, } from '../providers.js';
import { saveApiKeyToEnv, getApiKey } from '../config.js';
const VISIBLE_PROVIDERS = 12;
const VISIBLE_MODELS = 10;
export function ConnectOverlay({ theme, onClose, onSelect }) {
    const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
    const [selectedModelIndex, setSelectedModelIndex] = useState(0);
    const [state, setState] = useState('selecting-provider');
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [runtimeModels, setRuntimeModels] = useState([]);
    const [isCheckingRuntime, setIsCheckingRuntime] = useState(false);
    const [runtimeError, setRuntimeError] = useState(null);
    const [runtimeStatus, setRuntimeStatus] = useState(null);
    const providerScrollRef = useRef(null);
    const modelScrollRef = useRef(null);
    const sortedProviders = useMemo(() => [...RUNTIME_PROVIDERS].sort((a, b) => a.name.localeCompare(b.name)), []);
    const selectedProvider = sortedProviders[selectedProviderIndex];
    const providerModels = useMemo(() => {
        if (!selectedProvider)
            return [];
        if (runtimeModels.length > 0)
            return runtimeModels;
        return selectedProvider.models || [];
    }, [selectedProvider, runtimeModels]);
    const selectedModel = providerModels[selectedModelIndex];
    const requiresAuth = useMemo(() => {
        return selectedProvider ? providerRequiresAuth(selectedProvider.id) : false;
    }, [selectedProvider]);
    const isLocal = useMemo(() => {
        return selectedProvider?.isLocal === true;
    }, [selectedProvider]);
    const hasApiKey = useMemo(() => {
        if (!selectedProvider)
            return false;
        const envVar = getApiKeyEnvVar(selectedProvider.id);
        if (!envVar)
            return false;
        return !!getApiKey(envVar);
    }, [selectedProvider]);
    const existingApiKey = useMemo(() => {
        if (!selectedProvider)
            return '';
        const envVar = getApiKeyEnvVar(selectedProvider.id);
        if (!envVar)
            return '';
        return getApiKey(envVar) || '';
    }, [selectedProvider]);
    const handleProviderSelect = useCallback(async () => {
        if (!selectedProvider)
            return;
        if (isLocal) {
            setState('checking-runtime');
            setIsCheckingRuntime(true);
            setRuntimeError(null);
            try {
                const baseURL = getProviderBaseURL(selectedProvider) || 'http://localhost:1234/v1';
                const isHealthy = await checkRuntimeHealth(baseURL);
                if (isHealthy) {
                    setRuntimeStatus('Runtime is running');
                    const models = await fetchLocalModels(baseURL);
                    if (models.length > 0) {
                        const sorted = [...models].sort((a, b) => {
                            if (a.default && !b.default)
                                return -1;
                            if (!a.default && b.default)
                                return 1;
                            return a.name.localeCompare(b.name);
                        });
                        setRuntimeModels(sorted);
                        setState('selecting-model');
                        const loadedIdx = sorted.findIndex((m) => m.default);
                        setSelectedModelIndex(loadedIdx >= 0 ? loadedIdx : 0);
                    }
                    else {
                        setRuntimeError('No models found in runtime');
                        setState('selecting-provider');
                    }
                }
                else {
                    setRuntimeError(`Runtime not accessible at ${baseURL}`);
                    setState('selecting-provider');
                }
            }
            catch (error) {
                setRuntimeError(`Error checking runtime: ${error}`);
                setState('selecting-provider');
            }
            finally {
                setIsCheckingRuntime(false);
            }
            return;
        }
        if (requiresAuth) {
            setState('entering-api-key');
            setApiKeyInput(hasApiKey ? existingApiKey : '');
            setRuntimeError(null);
        }
        else {
            setState('selecting-model');
            setSelectedModelIndex(0);
        }
    }, [selectedProvider, isLocal, requiresAuth, hasApiKey]);
    const handleApiKeySubmit = useCallback(async () => {
        if (!selectedProvider) {
            setState('selecting-provider');
            return;
        }
        const envVar = getApiKeyEnvVar(selectedProvider.id);
        if (!envVar) {
            setState('selecting-provider');
            return;
        }
        const key = apiKeyInput.trim();
        // If empty but has existing key, use the existing key
        const effectiveKey = key || existingApiKey;
        if (!effectiveKey) {
            setRuntimeError('API key is required');
            return;
        }
        // Only save if the key actually changed or this is a first-time set
        if (key && key !== existingApiKey) {
            const saved = saveApiKeyToEnv(envVar, key);
            if (!saved) {
                setState('selecting-provider');
                return;
            }
        }
        setApiKeyInput('');
        // For OpenRouter, fetch models after confirming key
        if (selectedProvider?.id === 'openrouter') {
            setState('fetching-models');
            setIsCheckingRuntime(true);
            setRuntimeError(null);
            try {
                const models = await fetchOpenRouterModels(effectiveKey);
                if (models.length > 0) {
                    setRuntimeModels(models);
                    setState('selecting-model');
                    setSelectedModelIndex(0);
                }
                else {
                    setRuntimeError('No models found from OpenRouter');
                    setState('entering-api-key');
                }
            }
            catch (error) {
                setRuntimeError(`Error fetching OpenRouter models: ${error}`);
                setState('entering-api-key');
            }
            finally {
                setIsCheckingRuntime(false);
            }
            return;
        }
        setState('selecting-model');
        setSelectedModelIndex(0);
    }, [selectedProvider, apiKeyInput, existingApiKey]);
    const handleModelSelect = useCallback(async () => {
        if (!selectedProvider || !selectedModel)
            return;
        const envVar = getApiKeyEnvVar(selectedProvider.id);
        const apiKey = envVar ? getApiKey(envVar) : undefined;
        await onSelect?.(selectedProvider, selectedModel, apiKey);
        onClose();
    }, [selectedProvider, selectedModel, onSelect, onClose]);
    const handleBack = useCallback(() => {
        setState('selecting-provider');
        setApiKeyInput('');
        setRuntimeError(null);
        setRuntimeStatus(null);
        setRuntimeModels([]);
    }, []);
    useKeyboard((keyEvent) => {
        if (keyEvent.name === 'escape' || keyEvent.name === 'Escape') {
            if (state === 'entering-api-key' ||
                state === 'selecting-model' ||
                state === 'checking-runtime') {
                handleBack();
            }
            else {
                onClose();
            }
            keyEvent.preventDefault?.();
            keyEvent.stopPropagation?.();
            return;
        }
        if (keyEvent.name === 'return' || keyEvent.name === 'Enter') {
            if (state === 'entering-api-key') {
                handleApiKeySubmit();
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
                return;
            }
            if (state === 'selecting-provider') {
                handleProviderSelect();
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
                return;
            }
            if (state === 'selecting-model') {
                handleModelSelect();
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
                return;
            }
            return;
        }
        // Let input component handle text when entering API key
        if (state === 'entering-api-key') {
            return;
        }
        if (keyEvent.name === 'up' || keyEvent.name === 'ArrowUp') {
            if (state === 'selecting-provider') {
                setSelectedProviderIndex((s) => {
                    const next = Math.max(0, s - 1);
                    setSelectedModelIndex(0);
                    setRuntimeError(null);
                    setRuntimeStatus(null);
                    return next;
                });
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else if (state === 'selecting-model') {
                setSelectedModelIndex((s) => Math.max(0, s - 1));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
        if (keyEvent.name === 'down' || keyEvent.name === 'ArrowDown') {
            if (state === 'selecting-provider') {
                setSelectedProviderIndex((s) => {
                    const next = Math.min(sortedProviders.length - 1, s + 1);
                    setSelectedModelIndex(0);
                    setRuntimeError(null);
                    setRuntimeStatus(null);
                    return next;
                });
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else if (state === 'selecting-model') {
                setSelectedModelIndex((s) => Math.min(providerModels.length - 1, s + 1));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
        if (keyEvent.name === 'pageup' || keyEvent.name === 'PageUp') {
            if (state === 'selecting-provider') {
                setSelectedProviderIndex((s) => {
                    const next = Math.max(0, s - VISIBLE_PROVIDERS);
                    setSelectedModelIndex(0);
                    return next;
                });
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else if (state === 'selecting-model') {
                setSelectedModelIndex((s) => Math.max(0, s - VISIBLE_MODELS));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
        if (keyEvent.name === 'pagedown' || keyEvent.name === 'PageDown') {
            if (state === 'selecting-provider') {
                setSelectedProviderIndex((s) => {
                    const next = Math.min(sortedProviders.length - 1, s + VISIBLE_PROVIDERS);
                    setSelectedModelIndex(0);
                    return next;
                });
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            else if (state === 'selecting-model') {
                setSelectedModelIndex((s) => Math.min(providerModels.length - 1, s + VISIBLE_MODELS));
                keyEvent.preventDefault?.();
                keyEvent.stopPropagation?.();
            }
            return;
        }
    }, { release: false });
    const header = (_jsxs("box", { flexDirection: "row", justifyContent: "space-between", paddingX: 2, paddingY: 1, flexShrink: 0, children: [_jsx("text", { fg: theme.headerFg, children: "Connect a Provider" }), _jsx("text", { fg: theme.mutedFg, children: "Esc to close" })] }));
    useEffect(() => {
        providerScrollRef.current?.scrollChildIntoView(`provider-${selectedProviderIndex}`);
    }, [selectedProviderIndex]);
    useEffect(() => {
        if (state === 'selecting-model') {
            modelScrollRef.current?.scrollChildIntoView(`model-${selectedModelIndex}`);
        }
    }, [selectedModelIndex, state]);
    if (state === 'entering-api-key' && selectedProvider) {
        const hasExisting = !!existingApiKey;
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", borderStyle: "double", borderColor: theme.borderColor, backgroundColor: theme.bgPanel, children: [header, _jsxs("box", { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs("text", { fg: theme.headerFg, children: [selectedProvider.icon, " ", selectedProvider.name] }), _jsxs("text", { fg: theme.mutedFg, children: ["API key for ", getApiKeyEnvVar(selectedProvider.id)] }), hasExisting && (_jsx("text", { fg: theme.agentFg, children: "Current key is set \u00B7 Type to replace or Enter to keep" })), _jsxs("box", { flexDirection: "row", paddingY: 1, children: [_jsx("text", { fg: theme.inputFg, children: "Key: " }), _jsx("input", { focused: true, flexGrow: 0, value: apiKeyInput, onInput: setApiKeyInput, placeholder: hasExisting ? 'keep existing key' : 'paste key here' })] }), runtimeError && _jsxs("text", { fg: theme.errorFg, children: ["Error: ", runtimeError] }), _jsx("text", { fg: theme.mutedFg, children: hasExisting
                                ? 'Enter to keep current key · Type new key to change · Esc to cancel'
                                : 'Enter to save · Esc to cancel' })] })] }));
    }
    if (state === 'checking-runtime' && selectedProvider) {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", borderStyle: "double", borderColor: theme.borderColor, backgroundColor: theme.bgPanel, children: [header, _jsxs("box", { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs("text", { fg: theme.headerFg, children: [selectedProvider.icon, " ", selectedProvider.name] }), _jsx("text", { fg: theme.mutedFg, children: isCheckingRuntime ? 'Checking runtime...' : runtimeStatus }), runtimeError && _jsxs("text", { fg: theme.errorFg, children: ["Error: ", runtimeError] }), _jsxs("text", { fg: theme.mutedFg, marginTop: 1, children: ["Please ensure ", selectedProvider.name, " is running at", ' ', getProviderBaseURL(selectedProvider)] }), _jsx("text", { fg: theme.mutedFg, children: "Esc to go back" })] })] }));
    }
    if (state === 'fetching-models' && selectedProvider) {
        return (_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", borderStyle: "double", borderColor: theme.borderColor, backgroundColor: theme.bgPanel, children: [header, _jsxs("box", { flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsxs("text", { fg: theme.headerFg, children: [selectedProvider.icon, " ", selectedProvider.name] }), _jsx("text", { fg: theme.mutedFg, children: isCheckingRuntime ? 'Fetching models from OpenRouter...' : 'Fetching models...' }), runtimeError && _jsxs("text", { fg: theme.errorFg, children: ["Error: ", runtimeError] }), _jsx("text", { fg: theme.mutedFg, marginTop: 1, children: "Connecting to OpenRouter API to get latest model list" }), _jsx("text", { fg: theme.mutedFg, children: "Esc to go back" })] })] }));
    }
    return (_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", borderStyle: "double", borderColor: theme.borderColor, backgroundColor: theme.bgPanel, children: [header, _jsxs("box", { flexDirection: "row", flexGrow: 1, minHeight: 0, overflow: "hidden", children: [_jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", paddingX: 1, children: [_jsx("text", { fg: theme.headerFg, children: "Providers" }), _jsx("scrollbox", { ref: providerScrollRef, flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, children: sortedProviders.map((provider, i) => {
                                    const isSel = i === selectedProviderIndex;
                                    return (_jsxs("text", { id: `provider-${i}`, fg: isSel ? theme.headerFg : theme.mutedFg, bg: isSel ? theme.bgSelected : undefined, children: [isSel ? '> ' : '  ', provider.icon, " ", provider.name] }, provider.id));
                                }) }), _jsx("text", { fg: theme.mutedFg, flexShrink: 0, children: "\u2191\u2193 Navigate \u00B7 Enter Select" })] }), _jsx("box", { width: 1, flexShrink: 0, border: true, borderColor: theme.borderColor }), _jsxs("box", { flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "hidden", paddingX: 1, children: [_jsx("text", { fg: theme.headerFg, children: "Available Models" }), selectedProvider ? (_jsxs(_Fragment, { children: [_jsxs("box", { flexDirection: "column", marginTop: 1, flexShrink: 0, children: [_jsxs("text", { fg: theme.userFg, children: [selectedProvider.icon, " ", selectedProvider.name] }), selectedProvider.description && (_jsx("text", { fg: theme.mutedFg, children: selectedProvider.description })), requiresAuth && (_jsx("text", { fg: hasApiKey ? theme.agentFg : theme.mutedFg, children: hasApiKey ? '✓ API key configured' : 'Requires API key' })), isLocal && _jsx("text", { fg: theme.mutedFg, children: "Local runtime" })] }), state === 'selecting-model' ? (providerModels.length > 0 ? (_jsx("scrollbox", { ref: modelScrollRef, flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, marginTop: 1, children: providerModels.map((model, i) => {
                                            const isSel = i === selectedModelIndex;
                                            return (_jsxs("text", { id: `model-${i}`, fg: isSel ? theme.agentFg : theme.mutedFg, bg: isSel ? theme.bgSelected : undefined, children: [isSel ? '> ' : '  ', model.name, model.default ? ' [DEFAULT]' : ''] }, model.id));
                                        }) })) : (_jsx("box", { flexDirection: "column", justifyContent: "center", flexGrow: 1, minHeight: 0, children: _jsx("text", { fg: theme.mutedFg, children: "No models available" }) }))) : (_jsx("box", { flexDirection: "column", justifyContent: "center", flexGrow: 1, minHeight: 0, children: _jsx("text", { fg: theme.mutedFg, children: "Select provider and press Enter" }) })), state === 'selecting-model' && selectedModel && (_jsx("text", { fg: theme.mutedFg, marginTop: 1, flexShrink: 0, children: selectedModel.description || 'Select a model to connect' })), _jsx("text", { fg: theme.mutedFg, marginTop: 1, flexShrink: 0, children: state === 'selecting-model'
                                            ? '↑↓ Select model · Enter Connect · Esc Back'
                                            : 'Press Enter to continue' })] })) : (_jsx("box", { flexDirection: "column", justifyContent: "center", flexGrow: 1, minHeight: 0, children: _jsx("text", { fg: theme.mutedFg, children: "Select a provider to view available models" }) }))] })] })] }));
}
