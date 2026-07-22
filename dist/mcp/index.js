import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
/**
 * Interpolates {env:VAR} and {file:path} placeholders in a string value.
 */
function interpolateEnv(value) {
    return value
        .replace(/\{env:([^}]+)\}/g, (_, varName) => {
        return process.env[varName] ?? '';
    })
        .replace(/\{file:([^}]+)\}/g, (_, filePath) => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { readFileSync } = require('fs');
            return readFileSync(filePath, 'utf-8').trim();
        }
        catch {
            /* file not found or not readable */
            return '';
        }
    });
}
/**
 * Manages connections to MCP servers and exposes their tools
 * in the agent's Tool format.
 */
export class McpManager {
    connections = new Map();
    configs;
    constructor(configs) {
        this.configs = configs ?? {};
    }
    /**
     * Connect to all configured MCP servers.
     * Returns a summary of connection results.
     */
    async connectAll() {
        const states = [];
        const entries = Object.entries(this.configs);
        if (entries.length === 0)
            return states;
        // Connect to servers in parallel (up to 5 concurrent)
        const batchSize = 5;
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(([name, config]) => this.connectServer(name, config)));
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    states.push(result.value);
                }
                else {
                    states.push({
                        name: 'unknown',
                        status: 'error',
                        toolCount: 0,
                        error: result.reason?.message ?? String(result.reason),
                    });
                }
            }
        }
        return states;
    }
    /**
     * Connect to a single MCP server.
     */
    async connectServer(name, config) {
        // Check if explicitly disabled
        if (config.enabled === false) {
            const state = { name, status: 'disabled', toolCount: 0 };
            return state;
        }
        const client = new Client({ name: 'qwen-agent-tui', version: '1.1.0' });
        try {
            if (config.type === 'local') {
                await this.connectLocal(client, name, config);
            }
            else {
                await this.connectRemote(client, name, config);
            }
            // Discover tools
            const { tools: mcpTools } = await client.listTools();
            const tools = mcpTools.map((t) => ({
                name: t.name,
                description: t.description ?? `MCP tool: ${t.name}`,
                inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
            }));
            const serverInfo = client.getServerVersion() ?? undefined;
            const state = {
                name,
                status: 'connected',
                toolCount: tools.length,
                serverInfo: serverInfo ? { name: serverInfo.name, version: serverInfo.version } : undefined,
            };
            this.connections.set(name, { name, client, config, tools, state });
            return state;
        }
        catch (err) {
            const e = err;
            const state = {
                name,
                status: 'error',
                toolCount: 0,
                error: e.message ?? String(err),
            };
            // Try to close client on error
            try {
                await client.close();
            }
            catch {
                /* cleanup best-effort */
            }
            return state;
        }
    }
    /**
     * Connect to a local MCP server via stdio transport.
     */
    async connectLocal(client, name, config) {
        const [command, ...args] = config.command;
        const env = { ...process.env };
        if (config.env) {
            for (const [k, v] of Object.entries(config.env)) {
                env[k] = interpolateEnv(v);
            }
        }
        const transport = new StdioClientTransport({
            command,
            args,
            env,
            cwd: config.cwd,
        });
        await client.connect(transport);
    }
    /**
     * Connect to a remote MCP server via HTTP (Streamable HTTP or SSE).
     */
    async connectRemote(client, name, config) {
        const url = new URL(config.url);
        const headers = {};
        if (config.headers) {
            for (const [k, v] of Object.entries(config.headers)) {
                headers[k] = interpolateEnv(v);
            }
        }
        // Try Streamable HTTP first, fall back to SSE
        try {
            const transport = new StreamableHTTPClientTransport(url, {
                requestInit: { headers },
            });
            await client.connect(transport);
        }
        catch {
            // Fallback to SSE transport for older servers
            const sseTransport = new SSEClientTransport(url, {
                requestInit: { headers },
            });
            await client.connect(sseTransport);
        }
    }
    /**
     * Convert all discovered MCP tools into the agent's Tool format.
     * Each tool is prefixed with "mcp_<server>_" to avoid name collisions.
     */
    getTools() {
        const result = [];
        for (const [serverName, conn] of this.connections) {
            if (conn.state.status !== 'connected')
                continue;
            for (const mcpTool of conn.tools) {
                const toolName = `mcp_${serverName}_${mcpTool.name}`;
                result.push({
                    name: toolName,
                    description: `[MCP: ${serverName}] ${mcpTool.description}`,
                    parameters: mcpTool.inputSchema,
                    execute: (_args, _workspace) => {
                        return JSON.stringify({ ok: false, error: 'MCP tools require async execution' });
                    },
                    executeAsync: async (args, _workspace, _cfg, signal) => {
                        return this.callTool(serverName, mcpTool.name, args, signal);
                    },
                });
            }
        }
        return result;
    }
    /**
     * Call an MCP tool on a connected server.
     */
    async callTool(serverName, toolName, args, _signal) {
        const conn = this.connections.get(serverName);
        if (!conn) {
            return JSON.stringify({ ok: false, error: `MCP server "${serverName}" not connected` });
        }
        if (conn.state.status !== 'connected') {
            return JSON.stringify({
                ok: false,
                error: `MCP server "${serverName}" status: ${conn.state.status}`,
            });
        }
        try {
            const result = await conn.client.callTool({ name: toolName, arguments: args });
            // Extract text content from the result
            const content = result.content;
            if (Array.isArray(content)) {
                const texts = content;
                const filtered = texts.filter((c) => c.type === 'text').map((c) => c.text);
                if (filtered.length === 1)
                    return filtered[0];
                if (filtered.length > 1)
                    return JSON.stringify({ ok: true, output: filtered.join('\n') });
                // Non-text content (images, etc.)
                return JSON.stringify({ ok: true, content });
            }
            return JSON.stringify({ ok: true, result: content });
        }
        catch (err) {
            return JSON.stringify({
                ok: false,
                error: `MCP tool "${toolName}" on "${serverName}" failed: ${err.message ?? String(err)}`,
            });
        }
    }
    /**
     * Get the connection status of all configured servers.
     */
    getStates() {
        return Array.from(this.connections.values()).map((c) => c.state);
    }
    /**
     * Get the number of connected servers.
     */
    get connectedCount() {
        return Array.from(this.connections.values()).filter((c) => c.state.status === 'connected')
            .length;
    }
    /**
     * Get the total number of MCP tools available.
     */
    get totalTools() {
        return Array.from(this.connections.values()).reduce((sum, c) => sum + (c.state.status === 'connected' ? c.state.toolCount : 0), 0);
    }
    /**
     * Disconnect from all MCP servers and clean up resources.
     */
    async disconnectAll() {
        const closePromises = [];
        for (const conn of this.connections.values()) {
            closePromises.push(conn.client.close().catch(() => { }));
        }
        await Promise.allSettled(closePromises);
        this.connections.clear();
    }
    /**
     * Disconnect from a specific server.
     */
    async disconnectServer(name) {
        const conn = this.connections.get(name);
        if (conn) {
            try {
                await conn.client.close();
            }
            catch {
                /* cleanup best-effort */
            }
            this.connections.delete(name);
        }
    }
    /**
     * Check if a tool name belongs to an MCP server.
     */
    isMcpTool(toolName) {
        return toolName.startsWith('mcp_');
    }
    /**
     * Parse an MCP tool name back to server and tool names.
     */
    parseMcpToolName(prefixedName) {
        if (!prefixedName.startsWith('mcp_'))
            return null;
        const rest = prefixedName.slice(4); // remove "mcp_"
        const underscoreIdx = rest.indexOf('_');
        if (underscoreIdx === -1)
            return null;
        return {
            server: rest.slice(0, underscoreIdx),
            tool: rest.slice(underscoreIdx + 1),
        };
    }
}
/**
 * Create an McpManager from config.
 */
export function createMcpManager(mcpConfigs) {
    return new McpManager(mcpConfigs);
}
