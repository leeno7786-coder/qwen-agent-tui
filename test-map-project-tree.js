const fs = require('fs');
const path = require('path');

// Simulate the new map_project_tree behavior
function buildMarkdownTree(currentPath, currentDepth, prefix = "", maxDepth = 2, isSmall = true) {
  if (currentDepth > maxDepth) return "";
  
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    let result = "";
    
    // Sort entries: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    
    // Limit entries for small models
    const maxEntries = isSmall ? 20 : 50;
    const limitedEntries = entries.slice(0, maxEntries);
    
    for (let i = 0; i < limitedEntries.length; i++) {
      const entry = limitedEntries[i];
      const isLast = i === limitedEntries.length - 1;
      
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) continue;
      
      // Skip common build/cache directories
      const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'out']);
      if (SKIP_DIRS.has(entry.name)) continue;
      
      const fullPath = path.resolve(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        // Add directory entry
        const displayPrefix = prefix + (isLast ? "└── " : "├── ");
        result += `${displayPrefix}${entry.name}/\n`;
        
        // Recursively add subdirectories
        const subTree = buildMarkdownTree(fullPath, currentDepth + 1, prefix + (isLast ? "    " : "│   "), maxDepth, isSmall);
        if (subTree) {
          result += subTree;
        }
      }
      // For small models, we skip files entirely to reduce token usage
    }
    
    return result;
  } catch (err) {
    // If we can't read a directory, just return empty result
    return "";
  }
}

// Test with current directory
console.log("=== Testing map_project_tree output ===");
const currentDir = process.cwd();
const treeOutput = buildMarkdownTree(currentDir, 0, "", 2, true);
console.log("Tree structure:");
console.log(treeOutput);

// Test with a smaller depth
console.log("\n=== With depth 1 ===");
const treeOutput2 = buildMarkdownTree(currentDir, 0, "", 1, true);
console.log(treeOutput2);