/**
 * Memory Graph System
 * 
 * A knowledge graph that stores information about the codebase:
 * - Files, functions, classes, variables, types
 * - Dependencies and relationships between them
 * - Concepts and documentation
 * 
 * Features:
 * - Build graph from source code
 * - Load/save existing graphs
 * - Query the graph for information
 * - Incremental updates
 */

import { GraphNode, GraphEdge, GraphQuery, GraphQueryResult, GraphBuildOptions } from './types';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const GRAPH_VERSION = '1.0.0';
const GRAPH_DIRECTORY = '.qwen-graph';
const GRAPH_FILE = 'memory-graph.json';
const HASH_FILE = 'graph-hash.json';

export class MemoryGraph {
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, GraphEdge>;
  private indexes: {
    byType: Map<string, Set<string>>;
    byPath: Map<string, Set<string>>;
    byName: Map<string, Set<string>>;
    byLanguage: Map<string, Set<string>>;
  };
  private version: string;
  private lastUpdated: number;
  private workspace: string;
  private graphDir: string;
  private options: GraphBuildOptions;

  constructor(workspace: string, options: GraphBuildOptions = {}) {
    this.workspace = workspace;
    this.graphDir = join(workspace, GRAPH_DIRECTORY);
    this.version = GRAPH_VERSION;
    this.lastUpdated = Date.now();
    this.options = {
      includeDependencies: true,
      includeCode: false,
      maxFileSize: 1024 * 1024, // 1MB
      excludedPaths: [
        'node_modules',
        'dist',
        'build',
        '.git',
        '.qwen-graph',
        '*.lock',
        '*.log'
      ],
      includedPaths: ['src', 'tests', 'lib'],
      ...options
    };

    this.nodes = new Map();
    this.edges = new Map();
    this.indexes = {
      byType: new Map(),
      byPath: new Map(),
      byName: new Map(),
      byLanguage: new Map()
    };
  }

  /**
   * Check if a graph already exists for this workspace
   */
  static exists(workspace: string): boolean {
    const graphDir = join(workspace, GRAPH_DIRECTORY);
    const graphFile = join(graphDir, GRAPH_FILE);
    return existsSync(graphFile);
  }

  /**
   * Load an existing graph from disk
   */
  static async load(workspace: string): Promise<MemoryGraph | null> {
    const graphDir = join(workspace, GRAPH_DIRECTORY);
    const graphFile = join(graphDir, GRAPH_FILE);
    
    if (!existsSync(graphFile)) {
      return null;
    }

    try {
      const data = JSON.parse(readFileSync(graphFile, 'utf-8'));
      const graph = new MemoryGraph(workspace);
      
      // Load nodes
      for (const node of data.nodes || []) {
        graph.addNode(node);
      }
      
      // Load edges
      for (const edge of data.edges || []) {
        graph.addEdge(edge);
      }

      graph.version = data.version || GRAPH_VERSION;
      graph.lastUpdated = data.lastUpdated || Date.now();

      return graph;
    } catch (error) {
      console.error('Error loading memory graph:', error);
      return null;
    }
  }

  /**
   * Create a new graph or load existing one
   */
  static async create(workspace: string, options: GraphBuildOptions = {}): Promise<MemoryGraph> {
    // Check if graph exists and is up to date
    const existingGraph = await MemoryGraph.load(workspace);
    if (existingGraph && await existingGraph.isUpToDate()) {
      return existingGraph;
    }

    // Create new graph
    const graph = new MemoryGraph(workspace, options);
    return graph;
  }

  /**
   * Check if the graph is up to date with the source files
   */
  async isUpToDate(): Promise<boolean> {
    const hashFile = join(this.graphDir, HASH_FILE);
    
    if (!existsSync(hashFile)) {
      return false;
    }

    try {
      const savedHashes = JSON.parse(readFileSync(hashFile, 'utf-8'));
      const currentHashes = await this.computeFileHashes();

      // Check if any tracked file has changed
      for (const [path, hash] of Object.entries(currentHashes)) {
        if (savedHashes[path] !== hash) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Compute hashes for all tracked files
   */
  private async computeFileHashes(): Promise<Record<string, string>> {
    const hashes: Record<string, string> = {};
    const files = this.findFiles(this.workspace);

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const hash = createHash('md5').update(content).digest('hex');
        hashes[relative(this.workspace, file)] = hash;
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return hashes;
  }

  /**
   * Find all files to index
   */
  private findFiles(directory: string): string[] {
    const files: string[] = [];
    
    try {
      for (const item of readdirSync(directory)) {
        const fullPath = join(directory, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip excluded directories
          if (this.options.excludedPaths?.some(p => item === p || fullPath.includes(`/${p}/`))) {
            continue;
          }
          
          // Recurse into included directories or all directories if no includes specified
          if (!this.options.includedPaths || this.options.includedPaths.some(p => fullPath.includes(`/${p}/`))) {
            files.push(...this.findFiles(fullPath));
          }
        } else if (stat.isFile()) {
          // Skip excluded files
          if (this.options.excludedPaths?.some(p => item === p || item.endsWith(p))) {
            continue;
          }
          
          // Check file size
          if (stat.size <= (this.options.maxFileSize || Infinity)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }

    return files;
  }

  /**
   * Build the graph from source code
   */
  async build(): Promise<void> {
    console.log('Building memory graph...');
    const startTime = Date.now();

    // Clear existing graph
    this.nodes.clear();
    this.edges.clear();
    this.indexes = {
      byType: new Map(),
      byPath: new Map(),
      byName: new Map(),
      byLanguage: new Map()
    };

    // Find and process all files
    const files = this.findFiles(this.workspace);
    console.log(`Found ${files.length} files to index`);

    for (const file of files) {
      try {
      await this.processFile(file);
    } catch (err: any) {
      console.warn(`Error processing file ${file}:`, err.message);
    }
    }

    // Build indexes
    this.buildIndexes();

    // Save the graph
    await this.save();

    console.log(`Memory graph built in ${Date.now() - startTime}ms`);
    console.log(`Nodes: ${this.nodes.size}, Edges: ${this.edges.size}`);
  }

  /**
   * Process a single file and extract nodes/edges
   */
  private async processFile(filePath: string): Promise<void> {
    const relativePath = relative(this.workspace, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const language = this.getLanguage(filePath);

    // Create file node
    const fileNode: GraphNode = {
      id: `file:${relativePath.replace(/\\/g, '/')}`,
      type: 'file',
      name: relativePath,
      path: relativePath,
      language,
      metadata: {
        size: statSync(filePath).size,
        mtime: statSync(filePath).mtimeMs
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.addNode(fileNode);

    // Extract nodes based on language
    switch (language) {
      case 'typescript':
      case 'javascript':
        await this.processTypeScriptFile(filePath, content, fileNode);
        break;
      case 'json':
        this.processJsonFile(filePath, content, fileNode);
        break;
      case 'markdown':
        this.processMarkdownFile(filePath, content, fileNode);
        break;
      case 'yaml':
      case 'yml':
        this.processYamlFile(filePath, content, fileNode);
        break;
      default:
        // For other files, just create the file node
        break;
    }
  }

  /**
   * Get language from file extension
   */
  private getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      py: 'python',
      java: 'java',
      go: 'go',
      rs: 'rust',
      php: 'php',
      rb: 'ruby'
    };
    return languageMap[ext || ''] || 'unknown';
  }

  /**
   * Process TypeScript/JavaScript file
   */
  private async processTypeScriptFile(filePath: string, content: string, fileNode: GraphNode): Promise<void> {
    // Simple parsing - in production, use a proper parser like @babel/parser or typescript-eslint
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/**')) {
        continue;
      }

      // Extract imports
      const importMatch = line.match(/^import\s+{(.+?)}\s+from\s+['"](.+?)['"]/);
      if (importMatch) {
        const imports = importMatch[1].split(',').map(i => i.trim());
        const from = importMatch[2];
        
        for (const imp of imports) {
          const importNode: GraphNode = {
            id: `import:${fileNode.id}:${imp}`,
            type: 'module',
            name: imp,
            path: from,
            line: lineNum,
            language: fileNode.language,
            metadata: {
              importedFrom: from,
              file: fileNode.id
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.addNode(importNode);
          
          this.addEdge({
            id: `edge:${fileNode.id}:${importNode.id}`,
            source: fileNode.id,
            target: importNode.id,
            type: 'imports',
            createdAt: Date.now()
          });
        }
        continue;
      }

      // Extract class definitions
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) {
        const className = classMatch[1];
        const classNode: GraphNode = {
          id: `class:${fileNode.id}:${className}`,
          type: 'class',
          name: className,
          path: fileNode.path,
          line: lineNum,
          language: fileNode.language,
          code: this.options.includeCode ? line : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(classNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${classNode.id}`,
          source: fileNode.id,
          target: classNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
        continue;
      }

      // Extract function definitions
      const funcMatch = line.match(/^\s*(async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        const funcName = funcMatch[2];
        const funcNode: GraphNode = {
          id: `function:${fileNode.id}:${funcName}`,
          type: 'function',
          name: funcName,
          path: fileNode.path,
          line: lineNum,
          language: fileNode.language,
          code: this.options.includeCode ? line : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(funcNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${funcNode.id}`,
          source: fileNode.id,
          target: funcNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
        continue;
      }

      // Extract arrow function assignments
      const arrowMatch = line.match(/^\s*const\s+(\w+)\s*=\s*\(/);
      if (arrowMatch) {
        const funcName = arrowMatch[1];
        const funcNode: GraphNode = {
          id: `function:${fileNode.id}:${funcName}`,
          type: 'function',
          name: funcName,
          path: fileNode.path,
          line: lineNum,
          language: fileNode.language,
          code: this.options.includeCode ? line : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(funcNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${funcNode.id}`,
          source: fileNode.id,
          target: funcNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
        continue;
      }

      // Extract type definitions
      const typeMatch = line.match(/^\s*(interface|type)\s+(\w+)/);
      if (typeMatch) {
        const typeName = typeMatch[2];
        const typeNode: GraphNode = {
          id: `type:${fileNode.id}:${typeName}`,
          type: 'type',
          name: typeName,
          path: fileNode.path,
          line: lineNum,
          language: fileNode.language,
          code: this.options.includeCode ? line : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(typeNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${typeNode.id}`,
          source: fileNode.id,
          target: typeNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
        continue;
      }

      // Extract variable declarations
      const varMatch = line.match(/^\s*(const|let|var)\s+(\w+)\s*[:=]/);
      if (varMatch) {
        const varName = varMatch[2];
        const varNode: GraphNode = {
          id: `variable:${fileNode.id}:${varName}`,
          type: 'variable',
          name: varName,
          path: fileNode.path,
          line: lineNum,
          language: fileNode.language,
          code: this.options.includeCode ? line : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(varNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${varNode.id}`,
          source: fileNode.id,
          target: varNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
      }
    }
  }

  /**
   * Process JSON file
   */
  private processJsonFile(filePath: string, content: string, fileNode: GraphNode): void {
    try {
      const data = JSON.parse(content);
      
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          const node: GraphNode = {
            id: `config:${fileNode.id}:${key}`,
            type: 'concept',
            name: key,
            description: typeof value === 'string' ? value : JSON.stringify(value),
            path: fileNode.path,
            metadata: {
              value: value,
              configType: typeof value
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.addNode(node);
          
          this.addEdge({
            id: `edge:${fileNode.id}:${node.id}`,
            source: fileNode.id,
            target: node.id,
            type: 'part_of',
            createdAt: Date.now()
          });
        }
      }
    } catch (error) {
      // Invalid JSON, skip
    }
  }

  /**
   * Process Markdown file
   */
  private processMarkdownFile(filePath: string, content: string, fileNode: GraphNode): void {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Extract headers (concepts)
      const headerMatch = line.match(/^(#+)\s+(.+)/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const title = headerMatch[2];
        
        const conceptNode: GraphNode = {
          id: `concept:${fileNode.id}:${title.replace(/\s+/g, '-').toLowerCase()}`,
          type: 'concept',
          name: title,
          description: `Header level ${level} in ${fileNode.name}`,
          path: fileNode.path,
          line: lineNum,
          metadata: {
            level,
            file: fileNode.id
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.addNode(conceptNode);
        
        this.addEdge({
          id: `edge:${fileNode.id}:${conceptNode.id}`,
          source: fileNode.id,
          target: conceptNode.id,
          type: 'part_of',
          createdAt: Date.now()
        });
      }
    }
  }

  /**
   * Process YAML file
   */
  private processYamlFile(filePath: string, content: string, fileNode: GraphNode): void {
    // Simple YAML parsing - in production, use a proper YAML parser
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      if (line && !line.startsWith('#')) {
        const match = line.match(/^(\w+):\s*(.+)/);
        if (match) {
          const key = match[1];
          const value = match[2];
          
          const node: GraphNode = {
            id: `config:${fileNode.id}:${key}`,
            type: 'concept',
            name: key,
            description: value,
            path: fileNode.path,
            line: lineNum,
            metadata: {
              value,
              configType: 'yaml'
            },
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.addNode(node);
          
          this.addEdge({
            id: `edge:${fileNode.id}:${node.id}`,
            source: fileNode.id,
            target: node.id,
            type: 'part_of',
            createdAt: Date.now()
          });
        }
      }
    }
  }

  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode): void {
    if (this.nodes.has(node.id)) {
      // Update existing node
      const existing = this.nodes.get(node.id)!;
      this.nodes.set(node.id, { ...existing, ...node, updatedAt: Date.now() });
    } else {
      // Add new node
      this.nodes.set(node.id, node);
    }
  }

  /**
   * Add an edge to the graph
   */
  addEdge(edge: GraphEdge): void {
    if (this.edges.has(edge.id)) {
      // Update existing edge
      const existing = this.edges.get(edge.id)!;
      this.edges.set(edge.id, { ...existing, ...edge, updatedAt: Date.now() });
    } else {
      // Add new edge
      this.edges.set(edge.id, edge);
    }
  }

  /**
   * Build indexes for faster querying
   */
  private buildIndexes(): void {
    this.indexes.byType.clear();
    this.indexes.byPath.clear();
    this.indexes.byName.clear();
    this.indexes.byLanguage.clear();

    for (const [id, node] of this.nodes) {
      // Index by type
      if (!this.indexes.byType.has(node.type)) {
        this.indexes.byType.set(node.type, new Set());
      }
      this.indexes.byType.get(node.type)!.add(id);

      // Index by path
      if (node.path) {
        if (!this.indexes.byPath.has(node.path)) {
          this.indexes.byPath.set(node.path, new Set());
        }
        this.indexes.byPath.get(node.path)!.add(id);
      }

      // Index by name
      if (!this.indexes.byName.has(node.name)) {
        this.indexes.byName.set(node.name, new Set());
      }
      this.indexes.byName.get(node.name)!.add(id);

      // Index by language
      if (node.language) {
        if (!this.indexes.byLanguage.has(node.language)) {
          this.indexes.byLanguage.set(node.language, new Set());
        }
        this.indexes.byLanguage.get(node.language)!.add(id);
      }
    }
  }

  /**
   * Save the graph to disk
   */
  async save(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.graphDir)) {
      mkdirSync(this.graphDir, { recursive: true });
    }

    // Save graph data
    const graphData = {
      version: this.version,
      lastUpdated: this.lastUpdated,
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values())
    };

    writeFileSync(join(this.graphDir, GRAPH_FILE), JSON.stringify(graphData, null, 2));

    // Save file hashes
    const hashes = await this.computeFileHashes();
    writeFileSync(join(this.graphDir, HASH_FILE), JSON.stringify(hashes, null, 2));

    console.log(`Memory graph saved to ${this.graphDir}`);
  }

  /**
   * Query the graph
   */
  query(query: GraphQuery): GraphQueryResult {
    const startTime = Date.now();
    const result: GraphQueryResult = {
      nodes: [],
      edges: [],
      paths: [],
      stats: {
        nodeCount: this.nodes.size,
        edgeCount: this.edges.size,
        queryTime: 0
      }
    };

    switch (query.type) {
      case 'node':
        result.nodes = this.queryNodes(query.query);
        break;
      case 'edge':
        result.edges = this.queryEdges(query.query);
        break;
      case 'path':
        result.paths = this.queryPaths(query.query);
        break;
      case 'pattern':
        result.nodes = typeof query.query === 'string' ? this.queryByPattern(query.query) : [];
        break;
      case 'semantic':
        result.nodes = this.querySemantic(query.query);
        break;
    }

    result.stats.queryTime = Date.now() - startTime;
    return result;
  }

  /**
   * Query nodes by criteria
   */
  private queryNodes(criteria: any): GraphNode[] {
    const results: GraphNode[] = [];

    if (typeof criteria === 'string') {
      // Query by ID
      const node = this.nodes.get(criteria);
      if (node) results.push(node);
    } else if (typeof criteria === 'object') {
      for (const [id, node] of this.nodes) {
        let matches = true;

        for (const [key, value] of Object.entries(criteria)) {
          if (key === 'type' && node.type !== value) {
            matches = false;
            break;
          }
          if (key === 'name' && node.name !== value) {
            matches = false;
            break;
          }
          if (key === 'path' && node.path !== value) {
            matches = false;
            break;
          }
          if (key === 'language' && node.language !== value) {
            matches = false;
            break;
          }
        }

        if (matches) {
          results.push(node);
        }
      }
    }

    return results.slice(0, criteria.limit || 100);
  }

  /**
   * Query edges by criteria
   */
  private queryEdges(criteria: any): GraphEdge[] {
    const results: GraphEdge[] = [];

    if (typeof criteria === 'string') {
      // Query by ID
      const edge = this.edges.get(criteria);
      if (edge) results.push(edge);
    } else if (typeof criteria === 'object') {
      for (const [id, edge] of this.edges) {
        let matches = true;

        for (const [key, value] of Object.entries(criteria)) {
          if (key === 'type' && edge.type !== value) {
            matches = false;
            break;
          }
          if (key === 'source' && edge.source !== value) {
            matches = false;
            break;
          }
          if (key === 'target' && edge.target !== value) {
            matches = false;
            break;
          }
        }

        if (matches) {
          results.push(edge);
        }
      }
    }

    return results.slice(0, criteria.limit || 100);
  }

  /**
   * Query paths between nodes
   */
  private queryPaths(criteria: any): string[][] {
    if (typeof criteria === 'object' && criteria.from && criteria.to) {
      return this.findPaths(criteria.from, criteria.to, criteria.maxDepth || 5);
    }
    return [];
  }

  /**
   * Find paths between two nodes using BFS
   */
  private findPaths(fromId: string, toId: string, maxDepth: number): string[][] {
    const paths: string[][] = [];
    const queue: { current: string; path: string[]; depth: number }[] = [
      { current: fromId, path: [fromId], depth: 0 }
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { current, path, depth } = queue.shift()!;

      if (depth > maxDepth) continue;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current === toId) {
        paths.push(path);
        if (paths.length >= 10) break; // Limit results
        continue;
      }

      // Find all edges from this node
      for (const [edgeId, edge] of this.edges) {
        if (edge.source === current) {
          queue.push({
            current: edge.target,
            path: [...path, edge.target],
            depth: depth + 1
          });
        }
      }
    }

    return paths;
  }

  /**
   * Query by pattern (simple text search)
   */
  private queryByPattern(pattern: string): GraphNode[] {
    const results: GraphNode[] = [];
    const regex = new RegExp(pattern, 'i');

    for (const [id, node] of this.nodes) {
      if (
        regex.test(node.id) ||
        regex.test(node.name) ||
        (node.description && regex.test(node.description)) ||
        (node.code && regex.test(node.code))
      ) {
        results.push(node);
        if (results.length >= 50) break; // Limit results
      }
    }

    return results;
  }

  /**
   * Semantic query (more advanced)
   */
  private querySemantic(criteria: any): GraphNode[] {
    const results: GraphNode[] = [];

    if (criteria.relatedTo) {
      // Find nodes related to a specific node
      const nodeId = criteria.relatedTo;
      const relatedNodes = new Set<string>();

      // Find all nodes connected to this node
      for (const [edgeId, edge] of this.edges) {
        if (edge.source === nodeId) {
          relatedNodes.add(edge.target);
        }
        if (edge.target === nodeId) {
          relatedNodes.add(edge.source);
        }
      }

      for (const id of relatedNodes) {
        const node = this.nodes.get(id);
        if (node) results.push(node);
      }
    }

    return results.slice(0, criteria.limit || 50);
  }

  /**
   * Get statistics about the graph
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    nodesByLanguage: Record<string, number>;
  } {
    const nodesByType: Record<string, number> = {};
    const nodesByLanguage: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
      if (node.language) {
        nodesByLanguage[node.language] = (nodesByLanguage[node.language] || 0) + 1;
      }
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      nodesByType,
      nodesByLanguage
    };
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.indexes = {
      byType: new Map(),
      byPath: new Map(),
      byName: new Map(),
      byLanguage: new Map()
    };
  }

  /**
   * Update an existing node
   */
  updateNode(id: string, updates: Partial<GraphNode>): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    this.nodes.set(id, { ...node, ...updates, updatedAt: Date.now() });
    this.buildIndexes();
    return true;
  }

  /**
   * Remove a node and its edges
   */
  removeNode(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove all edges connected to this node
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) {
        this.edges.delete(edgeId);
      }
    }

    this.nodes.delete(id);
    this.buildIndexes();
    return true;
  }

  /**
   * Export the graph as JSON
   */
  export(): { nodes: GraphNode[]; edges: GraphEdge[]; stats: any } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      stats: this.getStats()
    };
  }

  /**
   * Import a graph from JSON
   */
  import(data: { nodes: GraphNode[]; edges: GraphEdge[] }): void {
    this.clear();

    for (const node of data.nodes) {
      this.addNode(node);
    }

    for (const edge of data.edges) {
      this.addEdge(edge);
    }

    this.buildIndexes();
  }
}
