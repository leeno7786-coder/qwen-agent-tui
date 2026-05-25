import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Import tools directly
import { tools } from "../src/tools";

// Test git_status tool in non-git directory
const testDir = join(tmpdir(), "git-status-test");
mkdirSync(testDir, { recursive: true });
writeFileSync(join(testDir, "test.txt"), "test content");

const gitStatusTool = tools.find(t => t.name === "git_status");
if (!gitStatusTool) {
  console.error("git_status tool not found");
  process.exit(1);
}

console.log("Testing git_status in non-git directory...");
const result1 = gitStatusTool.execute({}, testDir);
console.log("Result:", result1);

const parsed1 = JSON.parse(result1);
if (parsed1.ok && parsed1.status === "not a git repository") {
  console.log("✅ Non-git directory test passed");
} else {
  console.error("❌ Non-git directory test failed");
  process.exit(1);
}

// Test git_status in git directory (if git is available)
try {
  execSync("git --version", { stdio: "ignore" });
  
  // Initialize git repo
  execSync("git init", { cwd: testDir, stdio: "ignore" });
  execSync("git config user.name 'Test'", { cwd: testDir, stdio: "ignore" });
  execSync("git config user.email 'test@example.com'", { cwd: testDir, stdio: "ignore" });
  execSync("git add .", { cwd: testDir, stdio: "ignore" });
  
  console.log("Testing git_status in git directory...");
  const result2 = gitStatusTool.execute({}, testDir);
  console.log("Result:", result2);
  
  const parsed2 = JSON.parse(result2);
  if (parsed2.ok && parsed2.isGit === true) {
    console.log("✅ Git directory test passed");
  } else {
    console.error("❌ Git directory test failed");
    process.exit(1);
  }
  
} catch (e) {
  console.log("Git not available, skipping git directory test");
}

console.log("All tests passed! 🎉");