// Simple test to verify git_status tool structure
const fs = require('fs');
const path = require('path');

// Read the tools file directly
const toolsContent = fs.readFileSync('src/tools/index.ts', 'utf8');

// Check if git_status tool exists and has the expected structure
if (toolsContent.includes('name: "git_status"')) {
  console.log("✅ git_status tool found in source");
  
  // Check if it has the improved error handling
  if (toolsContent.includes('git rev-parse --is-inside-work-tree')) {
    console.log("✅ git_status tool has git repository detection");
  } else {
    console.log("❌ git_status tool missing repository detection");
    process.exit(1);
  }
  
  if (toolsContent.includes('"not a git repository"')) {
    console.log("✅ git_status tool handles non-git repositories gracefully");
  } else {
    console.log("❌ git_status tool doesn't handle non-git repositories");
    process.exit(1);
  }
  
} else {
  console.log("❌ git_status tool not found");
  process.exit(1);
}

console.log("Git status tool verification passed! 🎉");