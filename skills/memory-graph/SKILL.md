---
name: memory-graph
description: Build and query a graph of the codebase (files, functions, classes, types, imports, calls) to understand architecture, find dependencies, and trace connections between code.
triggers:
  - "memory graph"
  - "code graph"
  - "architecture"
  - "dependency graph"
  - "understand the codebase"
  - "codebase structure"
  - "find dependencies"
  - "trace code"
---
# Memory Graph

The memory graph captures codebase structure as a queryable graph of nodes (files, functions, classes, types, variables, imports) and edges (imports, part_of, extends, implements, calls).

## Available tools

- **build_memory_graph** — scans the workspace and builds the graph. Run this first.
- **query_memory_graph** — query by type (`node`/`edge`/`path`/`pattern`/`semantic`)
- **get_graph_stats** — node counts by type and language
- **search_nodes_by_type** — find all nodes of a type (function, class, type, etc.)
- **search_nodes_by_name** — find nodes by name substring
- **search_nodes_by_path** — find nodes in a specific file
- **find_dependencies** — trace what a node depends on (up to N depth)
- **find_path** — shortest path between two nodes
- **pattern_search** — regex across all node data
- **get_file_info** — all nodes in a file

## Workflow

1. Run `build_memory_graph` to build the graph (may take a few seconds on large projects)
2. Use `get_graph_stats` for a quick overview
3. `query_memory_graph` for general queries, or use the specific search tools above
4. `find_path` to trace connections between two symbols
5. `find_dependencies` to understand what a module depends on
