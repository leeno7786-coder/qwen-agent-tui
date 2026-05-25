#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import path from 'path';

console.log('📁 Project root:', process.cwd());

// Check if skills directory exists
const skillsDir = path.join(process.cwd(), 'skills');
if (!existsSync(skillsDir)) {
    console.error('❌ Skills directory not found at:', skillsDir);
    process.exit(1);
}

console.log('✅ Skills directory exists:');
for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith('.json'))) {
    const fullPath = path.join(skillsDir, file);
    console.log(`   - ${file}`);
}

// Check code-review.json specifically
const crFile = path.join(skillsDir, 'code-review.json');
if (existsSync(crFile)) {
    const content = readFileSync(crFile).toString();
    if ('enabled': true' in content) {
        console.log('✅ Code-review skill is active and enabled');
    } else {
        console.warn('⚠️ Code-review skill exists but may not be enabled');
    }
} else {
    console.error('❌ code-review.json file not found');
}

console.log('\n📊 Summary: Skills directory structure appears correct.');