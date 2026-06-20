/**
 * Security hardening module for qwen-agent-tui.
 * Provides command validation, file access control, and sensitive data sanitization.
 */

import { resolve, relative, isAbsolute } from 'path';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';

/**
 * Security configuration options.
 */
export interface SecurityConfig {
  /** Enable security checks (default: true). */
  enabled: boolean;
  /** Enable command validation (default: true). */
  validateCommands: boolean;
  /** Enable file access control (default: true). */
  validateFileAccess: boolean;
  /** Enable API key sanitization (default: true). */
  sanitizeOutput: boolean;
  /** Additional blocked commands (regex patterns). */
  blockedCommands: RegExp[];
  /** Additional allowed commands (exact matches). */
  allowedCommands: Set<string>;
  /** Allowed file paths (glob patterns). */
  allowedPaths: string[];
  /** Blocked file paths (glob patterns). */
  blockedPaths: string[];
  /** Maximum file size to read (bytes). */
  maxFileSize: number;
  /** Maximum number of files to read in batch operations. */
  maxBatchFiles: number;
}

/**
 * Default security configuration.
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: true,
  validateCommands: true,
  validateFileAccess: true,
  sanitizeOutput: true,
  blockedCommands: [],
  allowedCommands: new Set([]),
  allowedPaths: [],
  blockedPaths: [
    '**/.env',
    '**/.env.*',
    '**/.git/**',
    '**/.ssh/**',
    '**/node_modules/**',
    '**/bun.lock',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/.npmrc',
    '**/.yarnrc',
    '**/tsconfig.json',
    '**/tsconfig.*.json',
    '**/bunfig.toml',
    '**/package.json',
    '**/composer.lock',
    '**/Gemfile.lock',
    '**/Cargo.lock',
    '**/go.mod',
    '**/go.sum',
    '**/Pipfile.lock',
    '**/poetry.lock',
    '**/requirements.txt',
    '**/config/**',
    '**/secrets/**',
    '**/credentials/**',
    '**/*.pem',
    '**/*.key',
    '**/*.crt',
    '**/*.cer',
    '**/*.p12',
    '**/*.pfx',
    '**/id_rsa*',
    '**/id_ed25519*',
    '**/id_ecdsa*',
    '**/known_hosts',
    '**/authorized_keys',
    '**/shadow',
    '**/passwd',
    '**/sudoers',
    '**/hosts',
    '**/resolv.conf',
    '**/etc/**',
    '**/var/**',
    '**/usr/**',
    '**/bin/**',
    '**/sbin/**',
    '**/boot/**',
    '**/dev/**',
    '**/proc/**',
    '**/sys/**',
    '**/tmp/**',
    '**/temp/**',
  ],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxBatchFiles: 50,
};

/**
 * Dangerous command patterns that should be blocked.
 */
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  // System destruction
  /rm\s+-rf/i,
  /rm\s+--no-preserve-root/i,
  /rm\s+-r\s+\//i,
  /dd\s+if=\/dev\//i,
  /mkfs/i,
  /format/i,
  
  // Process management
  /kill\s+-9/i,
  /pkill/i,
  /killall/i,
  /xkill/i,
  
  // Privilege escalation
  /sudo\s+/i,
  /su\s+/i,
  /chmod\s+777/i,
  /chmod\s+-R/i,
  /setuid/i,
  /setgid/i,
  /chown\s+0:0/i,
  
  // Network operations
  /nc\s+/i,
  /netcat\s+/i,
  /curl\s+.*-o\s+\//i,
  /wget\s+.*-O\s+\//i,
  /ssh\s+/i,
  /scp\s+/i,
  /sftp\s+/i,
  /telnet\s+/i,
  /ftp\s+/i,
  
  // File system operations
  /:\s*\//i, // Overwrite root
  />\s*\//i,
  />>\s*\//i,
  /mv\s+.+\s+\//i,
  /cp\s+.+\s+\//i,
  
  // Shell features
  /;\s*\//i,
  /&&\s*\//i,
  /\|\|\s*\//i,
  /\$\(/i,
  /`/i,
  /\|\s*sh/i,
  /\|\s*bash/i,
  /\|\s*zsh/i,
  /\|\s*dash/i,
  
  // Code execution
  /eval\s+/i,
  /exec\s+/i,
  /source\s+/i,
  /\.\s+/i,
  
  // Package managers (potentially destructive)
  /npm\s+install\s+-g/i,
  /npm\s+uninstall\s+-g/i,
  /yarn\s+global\s+add/i,
  /yarn\s+global\s+remove/i,
  /pnpm\s+add\s+-g/i,
  /pnpm\s+remove\s+-g/i,
  /gem\s+install/i,
  /pip\s+install\s+--user/i,
  /pip\s+uninstall/i,
  
  // Cron jobs
  /crontab/i,
  /^at\s+/i,
  /batch/i,
  /tasksch/i,
  
  // Service management
  /systemctl/i,
  /service\s+/i,
  /chkconfig/i,
  /ntsysv/i,
  
  // User management
  /useradd/i,
  /userdel/i,
  /usermod/i,
  /groupadd/i,
  /groupdel/i,
  /groupmod/i,
  /passwd/i,
  /shadow/i,
  
  // Kernel modules
  /insmod/i,
  /rmmod/i,
  /modprobe/i,
  /lsmod/i,
  
  // Hardware access
  /fdisk/i,
  /parted/i,
  /gparted/i,
  /sfdisk/i,
  /badblocks/i,
  /hdparm/i,
  /smartctl/i,
  
  // Memory operations
  /mkswap/i,
  /swapon/i,
  /swapoff/i,
  /dd\s+if=\/dev\/zero/i,
  /dd\s+if=\/dev\/urandom/i,
  
  // Archive operations
  /tar\s+--delete/i,
  /zip\s+-r/i,
  /unzip\s+-o/i,
  
  // Windows-specific
  /del\s+\\\\/i,
  /format\s+[a-zA-Z]:/i,
  /fdisk/i,
  /diskpart/i,
  /reg\s+delete/i,
  /reg\s+add/i,
  /reg\s+edit/i,
  /net\s+user/i,
  /net\s+localgroup/i,
];

/**
 * Safe command patterns that are always allowed.
 */
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  // Git operations
  /^git\s+status$/i,
  /^git\s+diff$/i,
  /^git\s+diff\s+--/i,
  /^git\s+log$/i,
  /^git\s+log\s+--/i,
  /^git\s+branch$/i,
  /^git\s+checkout$/i,
  /^git\s+checkout\s+--/i,
  /^git\s+pull$/i,
  /^git\s+push$/i,
  /^git\s+fetch$/i,
  /^git\s+add$/i,
  /^git\s+add\s+--/i,
  /^git\s+commit$/i,
  /^git\s+commit\s+--/i,
  /^git\s+stash$/i,
  /^git\s+reset$/i,
  /^git\s+reset\s+--/i,
  
  // File operations
  /^ls$/i,
  /^ls\s+--/i,
  /^dir$/i,
  /^dir\s+\//i,
  /^pwd$/i,
  /^cd$/i,
  /^cd\s+\S+/i,
  /^cat$/i,
  /^cat\s+\S+/i,
  /^type$/i,
  /^type\s+\S+/i,
  /^more$/i,
  /^more\s+\S+/i,
  /^less$/i,
  /^less\s+\S+/i,
  /^head$/i,
  /^head\s+--/i,
  /^tail$/i,
  /^tail\s+--/i,
  /^wc$/i,
  /^wc\s+--/i,
  /^find$/i,
  /^find\s+\S+/i,
  /^grep$/i,
  /^grep\s+--/i,
  /^grep\s+\S+/i,
  /^sort$/i,
  /^uniq$/i,
  /^awk$/i,
  /^sed$/i,
  /^cut$/i,
  /^tr$/i,
  /^echo$/i,
  /^echo\s+\S+/i,
  /^date$/i,
  /^whoami$/i,
  /^uname$/i,
  /^hostname$/i,
  /^which$/i,
  /^which\s+\S+/i,
  /^where$/i,
  /^where\s+\S+/i,
  
  // Node.js/Bun operations
  /^node\s+--version$/i,
  /^bun\s+--version$/i,
  /^npm\s+--version$/i,
  /^npm\s+test$/i,
  /^npm\s+run\s+\S+/i,
  /^bun\s+test$/i,
  /^bun\s+run\s+\S+/i,
  
  // Build tools
  /^make$/i,
  /^make\s+\S+/i,
  /^cmake$/i,
  /^cmake\s+\S+/i,
  /^cargo$/i,
  /^cargo\s+\S+/i,
  /^go\s+build$/i,
  /^go\s+test$/i,
  /^go\s+run$/i,
  
  // Text editors
  /^vim$/i,
  /^nano$/i,
  /^emacs$/i,
  /^code$/i,
  /^notepad$/i,
  
  // Version control
  /^hg$/i,
  /^hg\s+\S+/i,
  /^svn$/i,
  /^svn\s+\S+/i,
];

/**
 * Security manager for validating commands and file access.
 */
export class SecurityManager {
  private config: SecurityConfig;
  private workspace: string;

  constructor(config: Partial<SecurityConfig> = {}, workspace: string = '') {
    this.config = {
      ...DEFAULT_SECURITY_CONFIG,
      ...config,
    };
    this.workspace = workspace;
  }

  /**
   * Validate a command for safety.
   * @returns { ok: boolean, error?: string, command?: string } - Validation result
   */
  validateCommand(command: string): { ok: boolean; error?: string; command?: string } {
    if (!this.config.enabled || !this.config.validateCommands) {
      return { ok: true, command };
    }

    const trimmed = command.trim();
    if (!trimmed) {
      return { ok: false, error: 'Empty command' };
    }

    // Check against blocked commands
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { ok: false, error: `Command blocked: matches dangerous pattern` };
      }
    }

    // Check against custom blocked commands
    for (const pattern of this.config.blockedCommands) {
      if (pattern.test(trimmed)) {
        return { ok: false, error: `Command blocked: matches custom blocked pattern` };
      }
    }

    // Check against allowed commands (if any are specified)
    if (this.config.allowedCommands.size > 0) {
      const isAllowed = Array.from(this.config.allowedCommands).some(
        allowed => trimmed.toLowerCase() === allowed.toLowerCase()
      );
      if (!isAllowed) {
        return { ok: false, error: `Command not in allowed list` };
      }
    }

    // Check against safe patterns
    for (const pattern of SAFE_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { ok: true, command };
      }
    }

    // If we get here, the command wasn't explicitly allowed or blocked
    // For now, allow it but this could be made stricter
    return { ok: true, command };
  }

  /**
   * Validate file access for a path.
   * @returns { ok: boolean, error?: string, path?: string } - Validation result
   */
  validateFileAccess(path: string, operation: 'read' | 'write' | 'delete' | 'execute' = 'read'): {
    ok: boolean;
    error?: string;
    path?: string;
  } {
    if (!this.config.enabled || !this.config.validateFileAccess) {
      return { ok: true, path };
    }

    const resolved = this.resolvePath(path);
    if (!resolved) {
      return { ok: false, error: `Invalid path: ${path}` };
    }

    // Check if path is within workspace
    if (!this.isWithinWorkspace(resolved)) {
      return { ok: false, error: `Access denied: path escapes workspace` };
    }

    // Check against allowed paths first (if any are specified)
    // Allowed paths take precedence over blocked paths
    if (this.config.allowedPaths.length > 0) {
      const isAllowed = this.config.allowedPaths.some(pattern =>
        this.pathMatchesPattern(resolved, pattern)
      );
      if (!isAllowed) {
        return { ok: false, error: `Access denied: path not in allowed paths` };
      }
      // If path is in allowed paths, skip blocked paths check
    } else {
      // Check against blocked paths
      for (const pattern of this.config.blockedPaths) {
        if (this.pathMatchesPattern(resolved, pattern)) {
          return { ok: false, error: `Access denied: path matches blocked pattern (${pattern})` };
        }
      }
    }

    // Check file size for read operations
    if (operation === 'read' && existsSync(resolved)) {
      try {
        const stats = statSync(resolved);
        if (stats.size > this.config.maxFileSize) {
          return { ok: false, error: `File too large: ${stats.size} bytes (max ${this.config.maxFileSize})` };
        }
      } catch {
        // File doesn't exist or can't be stat'd
      }
    }

    // Check batch operations
    if (operation === 'read' && path.includes('*') && this.config.maxBatchFiles > 0) {
      // This is a glob pattern, check if it would match too many files
      // For now, we'll just allow it but this could be enhanced
    }

    return { ok: true, path: resolved };
  }

  /**
   * Resolve a path relative to the workspace.
   */
  private resolvePath(path: string): string | null {
    try {
      if (isAbsolute(path)) {
        return path;
      }
      if (this.workspace) {
        return resolve(this.workspace, path);
      }
      return resolve(path);
    } catch {
      return null;
    }
  }

  /**
   * Check if a path is within the workspace.
   */
  private isWithinWorkspace(path: string): boolean {
    if (!this.workspace) {
      return true; // No workspace restriction
    }
    
    const workspace = resolve(this.workspace);
    const resolvedPath = resolve(path);
    
    // Check if the resolved path starts with the workspace
    return resolvedPath.startsWith(workspace + (workspace.endsWith('/') || workspace.endsWith('\\') ? '' : '/')) ||
           resolvedPath.startsWith(workspace);
  }

  /**
   * Check if a path matches a glob pattern.
   */
  private pathMatchesPattern(path: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    
    // Simple glob matching for common patterns
    // Handle ** patterns (recursive)
    if (normalizedPattern.includes('**/')) {
      const parts = normalizedPattern.split('**/');
      const prefix = parts[0].replace(/\*/g, '.*').replace(/\?/g, '.');
      const suffix = parts.slice(1).join('.*').replace(/\*/g, '.*').replace(/\?/g, '.');
      const regexPattern = '^' + prefix + '.*' + suffix + '$';
      try {
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(normalizedPath);
      } catch {
        return false;
      }
    }
    
    // Handle patterns ending with /**
    if (normalizedPattern.endsWith('/**')) {
      const prefix = normalizedPattern.slice(0, -3).replace(/\*/g, '.*').replace(/\?/g, '.');
      const regexPattern = '^' + prefix + '.*$';
      try {
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(normalizedPath);
      } catch {
        return false;
      }
    }
    
    // Handle patterns starting with **/
    if (normalizedPattern.startsWith('**/')) {
      const suffix = normalizedPattern.slice(3).replace(/\*/g, '.*').replace(/\?/g, '.');
      const regexPattern = '^.*' + suffix + '$';
      try {
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(normalizedPath);
      } catch {
        return false;
      }
    }
    
    // Handle simple * patterns
    const regexPattern = '^' + normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.') + '$';
    
    try {
      const regex = new RegExp(regexPattern, 'i');
      return regex.test(normalizedPath);
    } catch {
      return false;
    }
  }

  /**
   * Sanitize output to remove sensitive information.
   */
  sanitizeOutput(output: string, apiKey?: string): string {
    if (!this.config.enabled || !this.config.sanitizeOutput) {
      return output;
    }

    let sanitized = output;

    // Sanitize API keys
    if (apiKey) {
      const keyPrefix = apiKey.slice(0, 8);
      sanitized = sanitized.replace(new RegExp(keyPrefix + '.*', 'g'), '[REDACTED_API_KEY]');
    }

    // Common API key patterns
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, '[OPENAI_KEY_REDACTED]');
    sanitized = sanitized.replace(/or-[a-zA-Z0-9]{20,}/g, '[OPENROUTER_KEY_REDACTED]');
    sanitized = sanitized.replace(/xai-[a-zA-Z0-9]{20,}/g, '[XAI_KEY_REDACTED]');
    sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{35}/g, '[GOOGLE_KEY_REDACTED]');
    sanitized = sanitized.replace(/eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, '[JWT_REDACTED]');

    // Bearer tokens (check before other auth patterns)
    sanitized = sanitized.replace(/auth:\s*Bearer\s+[^\s,;\"']+/gi, 'auth: Bearer [REDACTED]');
    sanitized = sanitized.replace(/bearer\s+[^\s,;\"']+/gi, 'Bearer [REDACTED]');

    // Passwords and secrets
    sanitized = sanitized.replace(/password[=:]\s*[^\s]+/gi, 'password=[REDACTED]');
    sanitized = sanitized.replace(/secret[=:]\s*[^\s]+/gi, 'secret=[REDACTED]');
    sanitized = sanitized.replace(/token[=:]\s*[^\s]+/gi, 'token=[REDACTED]');
    sanitized = sanitized.replace(/api[_-]?key[=:]\s*[^\s]+/gi, 'api_key=[REDACTED]');
    sanitized = sanitized.replace(/auth[=:]\s*[^\s]+/gi, 'auth=[REDACTED]');

    // Private keys
    sanitized = sanitized.replace(/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----.*-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gs, '[PRIVATE_KEY_REDACTED]');
    sanitized = sanitized.replace(/ssh-rsa\s+[A-Za-z0-9+/=]+/g, '[SSH_KEY_REDACTED]');

    // AWS credentials
    sanitized = sanitized.replace(/AKIA[0-9A-Z]{16}/g, '[AWS_ACCESS_KEY_REDACTED]');
    sanitized = sanitized.replace(/[a-zA-Z0-9/+]{40}/g, (match) => {
      // Only redact if it looks like a secret (not a hash or ID)
      if (/^[a-zA-Z0-9]{40}$/.test(match) && !/^[0-9a-f]{40}$/i.test(match)) {
        return '[POSSIBLE_SECRET_REDACTED]';
      }
      return match;
    });

    // File paths that might contain secrets
    sanitized = sanitized.replace(/\.env(\.\w+)?/g, '.env[REDACTED]');
    sanitized = sanitized.replace(/config\.json/g, 'config.json[REDACTED]');
    sanitized = sanitized.replace(/secrets?\.\w+/g, 'secrets[REDACTED]');

    return sanitized;
  }

  /**
   * Check if a path is safe to access.
   */
  isSafePath(path: string): boolean {
    const result = this.validateFileAccess(path, 'read');
    return result.ok;
  }

  /**
   * Check if a command is safe to execute.
   */
  isSafeCommand(command: string): boolean {
    const result = this.validateCommand(command);
    return result.ok;
  }

  /**
   * Update security configuration.
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  /**
   * Set workspace for path validation.
   */
  setWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  /**
   * Enable or disable security checks.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

/**
 * Create a security manager from configuration.
 */
export function createSecurityManager(
  config?: Partial<SecurityConfig>,
  workspace?: string
): SecurityManager {
  return new SecurityManager(config, workspace);
}

/**
 * Global security manager instance.
 */
export const globalSecurityManager = new SecurityManager();
