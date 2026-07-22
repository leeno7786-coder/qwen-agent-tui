import { existsSync, readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
export function detectContext(workspace) {
    const ctx = {
        isGit: false,
        files: [],
        projectType: 'unknown',
        primaryLanguage: 'unknown',
    };
    try {
        execSync('git rev-parse --git-dir', { cwd: workspace, stdio: 'ignore' });
        ctx.isGit = true;
        ctx.branch = execSync('git branch --show-current', {
            cwd: workspace,
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
    }
    catch {
        /* not git */
    }
    try {
        ctx.files = readdirSync(workspace, { recursive: true, encoding: 'utf-8' })
            .filter((f) => typeof f === 'string' && !f.includes('node_modules') && !f.includes('.git'))
            .slice(0, 50);
    }
    catch {
        /* workspace may not be readable */
    }
    // Detect project type and primary language — prioritize manifest files over extensions
    const hasPackageJson = ctx.files.some((f) => f === 'package.json' || f.endsWith('/package.json'));
    const hasTsConfig = ctx.files.some((f) => f === 'tsconfig.json' || f.endsWith('/tsconfig.json'));
    const hasCargoToml = ctx.files.some((f) => f === 'Cargo.toml' || f.endsWith('/Cargo.toml'));
    const hasGoMod = ctx.files.some((f) => f === 'go.mod' || f.endsWith('/go.mod'));
    const hasBuildGradle = ctx.files.some((f) => f.includes('build.gradle') || f.includes('pom.xml'));
    const hasRequirementsTxt = ctx.files.some((f) => f === 'requirements.txt' || f.endsWith('/requirements.txt'));
    const hasPyProject = ctx.files.some((f) => f === 'pyproject.toml' || f === 'setup.py' || f.endsWith('/pyproject.toml'));
    const tsCount = ctx.files.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).length;
    const jsCount = ctx.files.filter((f) => f.endsWith('.js') || f.endsWith('.jsx')).length;
    const pyCount = ctx.files.filter((f) => f.endsWith('.py')).length;
    const rsCount = ctx.files.filter((f) => f.endsWith('.rs')).length;
    const goCount = ctx.files.filter((f) => f.endsWith('.go')).length;
    const javaCount = ctx.files.filter((f) => f.endsWith('.java')).length;
    if (hasPackageJson) {
        ctx.projectType = 'nodejs';
        if (hasTsConfig && tsCount > jsCount) {
            ctx.primaryLanguage = 'typescript';
        }
        else if (jsCount > 0) {
            ctx.primaryLanguage = 'javascript';
        }
    }
    else if (hasCargoToml || rsCount > 2) {
        ctx.projectType = 'rust';
        ctx.primaryLanguage = 'rust';
    }
    else if (hasGoMod || goCount > 2) {
        ctx.projectType = 'golang';
        ctx.primaryLanguage = 'go';
    }
    else if (hasBuildGradle || javaCount > 2) {
        ctx.projectType = 'java';
        ctx.primaryLanguage = 'java';
    }
    else if (hasPyProject || hasRequirementsTxt || pyCount > 2) {
        ctx.projectType = 'python';
        ctx.primaryLanguage = 'python';
    }
    const readmePath = resolve(workspace, 'README.md');
    if (existsSync(readmePath)) {
        try {
            ctx.readme = readFileSync(readmePath, 'utf-8').slice(0, 2000);
        }
        catch {
            /* README not readable */
        }
    }
    return ctx;
}
