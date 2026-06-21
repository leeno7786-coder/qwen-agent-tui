/**
 * Memory Graph Tools
 * 
 * Tools to query and interact with the memory graph
 */

import { MemoryGraph } from './MemoryGraph';
import type { GraphNode, GraphEdge, GraphQuery, GraphQueryResult } from './types';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Global graph instance cache
const graphCache: Map<string, MemoryGraph> = new Map();

/**
 * Get or create a memory graph for a workspace
 */
export async function getMemoryGraph(workspace: string): Promise<MemoryGraph> {
  // Check cache first
  if (graphCache.has(workspace)) {
    return graphCache.get(workspace)!;
  }

  // Try to load existing graph
  const existingGraph = await MemoryGraph.load(workspace);
  if (existingGraph && await existingGraph.isUpToDate()) {
    graphCache.set(workspace, existingGraph);
    return existingGraph;
  }

  // Create new graph
  const graph = new MemoryGraph(workspace);
  graphCache.set(workspace, graph);
  return graph;
}

/**
 * Build the memory graph for a workspace
 */
export async function build_memory_graph(args: { workspace?: string }): Promise<{
  ok: boolean;
  message: string;
  nodes?: number;
  edges?: number;
  time?: number;
}> {
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
      time: Date.now() - startTime
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Failed to build memory graph: ${err.message}`
    };
  }
}

/**
 * Query the memory graph
 */
export async function query_memory_graph(args: {
  workspace?: string;
  query: GraphQuery;
}): Promise<GraphQueryResult> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    return graph.query(args.query);
  } catch (error) {
    return {
      nodes: [],
      edges: [],
      paths: [],
      stats: {
        nodeCount: 0,
        edgeCount: 0,
        queryTime: 0
      }
    };
  }
}

/**
 * Get graph statistics
 */
export async function get_graph_stats(args: { workspace?: string }): Promise<{
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  nodesByLanguage: Record<string, number>;
}> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    return graph.getStats();
  } catch (error) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      nodesByType: {},
      nodesByLanguage: {}
    };
  }
}

/**
 * Search for nodes by type
 */
export async function search_nodes_by_type(args: {
  workspace?: string;
  type: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { type: args.type },
      limit: args.limit || 50
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Search for nodes by name
 */
export async function search_nodes_by_name(args: {
  workspace?: string;
  name: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { name: args.name },
      limit: args.limit || 50
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Search for nodes by path
 */
export async function search_nodes_by_path(args: {
  workspace?: string;
  path: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { path: args.path },
      limit: args.limit || 50
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Find dependencies of a node
 */
export async function find_dependencies(args: {
  workspace?: string;
  nodeId: string;
  maxDepth?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'semantic',
      query: {
        relatedTo: args.nodeId
      },
      limit: args.maxDepth ? (args.maxDepth * 10) : 50
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Find path between two nodes
 */
export async function find_path(args: {
  workspace?: string;
  from: string;
  to: string;
  maxDepth?: number;
}): Promise<string[][]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'path',
      query: {
        from: args.from,
        to: args.to,
        maxDepth: args.maxDepth || 5
      }
    });
    return result.paths;
  } catch (error) {
    return [];
  }
}

/**
 * Pattern search in the graph
 */
export async function pattern_search(args: {
  workspace?: string;
  pattern: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'pattern',
      query: args.pattern,
      limit: args.limit || 50
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Get file information from the graph
 */
export async function get_file_info(args: {
  workspace?: string;
  path: string;
}): Promise<GraphNode | null> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: {
        type: 'file',
        path: args.path
      },
      limit: 1
    });
    return result.nodes[0] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get function information from the graph
 */
export async function get_function_info(args: {
  workspace?: string;
  name: string;
  path?: string;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: {
        type: 'function',
        name: args.name,
        ...(args.path && { path: args.path })
      },
      limit: 10
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Get class information from the graph
 */
export async function get_class_info(args: {
  workspace?: string;
  name: string;
  path?: string;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: {
        type: 'class',
        name: args.name,
        ...(args.path && { path: args.path })
      },
      limit: 10
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * List all files in the graph
 */
export async function list_files(args: {
  workspace?: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { type: 'file' },
      limit: args.limit || 100
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * List all functions in the graph
 */
export async function list_functions(args: {
  workspace?: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { type: 'function' },
      limit: args.limit || 100
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * List all classes in the graph
 */
export async function list_classes(args: {
  workspace?: string;
  limit?: number;
}): Promise<GraphNode[]> {
  const workspace = args.workspace || process.cwd();
  
  try {
    const graph = await getMemoryGraph(workspace);
    const result = graph.query({
      type: 'node',
      query: { type: 'class' },
      limit: args.limit || 100
    });
    return result.nodes;
  } catch (error) {
    return [];
  }
}

/**
 * Clear the graph cache
 */
export function clear_graph_cache(): void {
  graphCache.clear();
}

/**
 * Get the graph for a workspace (for direct access)
 */
export async function get_graph(workspace: string): Promise<MemoryGraph | null> {
  try {
    return await getMemoryGraph(workspace);
  } catch (error) {
    return null;
  }
}

// Re-exported from index.ts to avoid ambiguity
// export { MemoryGraph };
