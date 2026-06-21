/**
 * Types for the memory graph system
 */

export interface GraphNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'variable' | 'type' | 'module' | 'dependency' | 'concept';
  name: string;
  description?: string;
  path?: string;
  line?: number;
  column?: number;
  code?: string;
  language?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'imports' | 'exports' | 'calls' | 'uses' | 'extends' | 'implements' | 'depends_on' | 'related_to' | 'part_of';
  weight?: number;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt?: number;
}

export interface GraphData {
  version: string;
  lastUpdated: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphQuery {
  type: 'node' | 'edge' | 'path' | 'pattern' | 'semantic';
  query: string | Record<string, any>;
  limit?: number;
  offset?: number;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths: string[][];
  stats: {
    nodeCount: number;
    edgeCount: number;
    queryTime: number;
  };
}

export interface GraphIndexOptions {
  indexTypes?: boolean;
  indexPaths?: boolean;
  indexNames?: boolean;
  indexByLanguage?: boolean;
}

export interface GraphBuildOptions {
  includeDependencies?: boolean;
  includeCode?: boolean;
  maxFileSize?: number;
  excludedPaths?: string[];
  includedPaths?: string[];
}

export type NodeType = GraphNode['type'];
export type EdgeType = GraphEdge['type'];
