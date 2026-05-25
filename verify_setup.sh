#!/bin/bash
echo "Testing Qwen Agent TUI setup..."

echo "1. Checking skills directory:"
ls -la skills/

echo ""
echo "2. Testing skills loading:"
node -e "
const { loadSkills } = require('./src/skills');
const skills = loadSkills();
console.log('Loaded skills:', Array.from(skills.keys()));
"

echo ""
echo "3. Checking main.py exists:"
ls -la main.py

echo ""
echo "Setup verification complete!"