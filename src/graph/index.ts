/**
 * Memory Graph Module
 * 
 * Provides a knowledge graph of the codebase for better understanding and querying.
 * 
 * Features:
 * - Build graph from source code
 * - Load/save existing graphs
 * - Query the graph for information
 * - Incremental updates
 * - Automatic detection of existing graphs
 */

export { MemoryGraph } from './MemoryGraph';
export type {
  GraphNode,
  GraphEdge,
  GraphQuery,
  GraphQueryResult,
  GraphData,
  GraphBuildOptions,
  GraphIndexOptions,
  NodeType,
  EdgeType
} from './types';
export {
  getMemoryGraph,
  build_memory_graph,
  query_memory_graph,
  get_graph_stats,
  search_nodes_by_type,
  search_nodes_by_name,
  search_nodes_by_path,
  find_dependencies,
  find_path,
  pattern_search,
  get_file_info,
  get_function_info,
  get_class_info,
  list_files,
  list_functions,
  list_classes,
  clear_graph_cache,
  get_graph,
} from './tools';
