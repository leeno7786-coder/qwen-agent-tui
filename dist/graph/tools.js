/**
 * Memory Graph Tools
 *
 * Tools to query and interact with the memory graph
 */
import { MemoryGraph } from './MemoryGraph.js';
// Global graph instance cache
const graphCache = new Map();
/**
 * Get or create a memory graph for a workspace.
 * Always checks staleness; rebuilds automatically when the graph is outdated.
 */
export async function getMemoryGraph(workspace, autoRebuild = true) {
    const cached = graphCache.get(workspace);
    // Check if cached graph is still usable
    if (cached) {
        const upToDate = await cached.isUpToDate().catch(() => false);
        if (upToDate) {
            return cached;
        }
        // Stale — fall through to load/rebuild
    }
    // Try to load existing graph from disk
    const existingGraph = await MemoryGraph.load(workspace);
    if (existingGraph) {
        const upToDate = await existingGraph.isUpToDate().catch(() => false);
        if (upToDate) {
            graphCache.set(workspace, existingGraph);
            return existingGraph;
        }
        // Loaded but stale — rebuild if auto-rebuild is enabled
        if (autoRebuild) {
            await existingGraph.build();
            graphCache.set(workspace, existingGraph);
            return existingGraph;
        }
        graphCache.set(workspace, existingGraph);
        return existingGraph;
    }
    // No existing graph — create and build
    const graph = new MemoryGraph(workspace);
    if (autoRebuild) {
        await graph.build();
    }
    graphCache.set(workspace, graph);
    return graph;
}
/**
 * Build the memory graph for a workspace
 */
export async function build_memory_graph(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const startTime = Date.now();
        await graph.build();
        const stats = graph.getStats();
        return {
            ok: true,
            message: `Memory graph built successfully`,
            nodes: stats.nodeCount,
            edges: stats.edgeCount,
            time: Date.now() - startTime,
        };
    }
    catch (err) {
        return {
            ok: false,
            message: `Failed to build memory graph: ${err.message}`,
        };
    }
}
/**
 * Query the memory graph
 */
export async function query_memory_graph(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        return graph.query(args.query);
    }
    catch {
        return {
            nodes: [],
            edges: [],
            paths: [],
            stats: {
                nodeCount: 0,
                edgeCount: 0,
                queryTime: 0,
            },
        };
    }
}
/**
 * Get graph statistics
 */
export async function get_graph_stats(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        return graph.getStats();
    }
    catch {
        return {
            nodeCount: 0,
            edgeCount: 0,
            nodesByType: {},
            nodesByLanguage: {},
        };
    }
}
/**
 * Search for nodes by type
 */
export async function search_nodes_by_type(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { type: args.type },
            limit: args.limit || 50,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Search for nodes by name
 */
export async function search_nodes_by_name(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { name: args.name },
            limit: args.limit || 50,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Search for nodes by path
 */
export async function search_nodes_by_path(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { path: args.path },
            limit: args.limit || 50,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Find dependencies of a node
 */
export async function find_dependencies(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'semantic',
            query: {
                relatedTo: args.nodeId,
            },
            limit: args.maxDepth ? args.maxDepth * 10 : 50,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Find path between two nodes
 */
export async function find_path(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'path',
            query: {
                from: args.from,
                to: args.to,
                maxDepth: args.maxDepth || 5,
            },
        });
        return result.paths;
    }
    catch {
        return [];
    }
}
/**
 * Pattern search in the graph
 */
export async function pattern_search(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'pattern',
            query: args.pattern,
            limit: args.limit || 50,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Get file information from the graph
 */
export async function get_file_info(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: {
                type: 'file',
                path: args.path,
            },
            limit: 1,
        });
        return result.nodes[0] || null;
    }
    catch {
        return null;
    }
}
/**
 * Get function information from the graph
 */
export async function get_function_info(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: {
                type: 'function',
                name: args.name,
                ...(args.path && { path: args.path }),
            },
            limit: 10,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Get class information from the graph
 */
export async function get_class_info(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: {
                type: 'class',
                name: args.name,
                ...(args.path && { path: args.path }),
            },
            limit: 10,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * List all files in the graph
 */
export async function list_files(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { type: 'file' },
            limit: args.limit || 100,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * List all functions in the graph
 */
export async function list_functions(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { type: 'function' },
            limit: args.limit || 100,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * List all classes in the graph
 */
export async function list_classes(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const result = graph.query({
            type: 'node',
            query: { type: 'class' },
            limit: args.limit || 100,
        });
        return result.nodes;
    }
    catch {
        return [];
    }
}
/**
 * Clear the graph cache
 */
export function clear_graph_cache() {
    graphCache.clear();
}
/**
 * Get the graph for a workspace (for direct access)
 */
export async function get_graph(workspace) {
    try {
        return await getMemoryGraph(workspace);
    }
    catch {
        return null;
    }
}
/**
 * Get communities from the memory graph
 */
export async function get_communities(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const communities = graph.getCommunities();
        return { ok: true, communities };
    }
    catch (e) {
        return { ok: false, communities: [], error: e.message };
    }
}
/**
 * Get god nodes (most connected nodes) from the memory graph
 */
export async function get_god_nodes(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const godNodes = graph.getGodNodes(args.limit || 10);
        return { ok: true, godNodes };
    }
    catch (e) {
        return { ok: false, godNodes: [], error: e.message };
    }
}
/**
 * Get surprising connections (cross-community edges) from the memory graph
 */
export async function get_surprising_connections(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const connections = graph.getSurprisingConnections(args.limit || 20);
        return { ok: true, connections };
    }
    catch (e) {
        return { ok: false, connections: [], error: e.message };
    }
}
/**
 * Generate a full analysis report from the memory graph
 */
export async function get_analysis_report(args) {
    const workspace = args.workspace || process.cwd();
    try {
        const graph = await getMemoryGraph(workspace);
        const report = graph.generateAnalysisReport();
        return { ok: true, report };
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
// Re-exported from index.ts to avoid ambiguity
// export { MemoryGraph };
