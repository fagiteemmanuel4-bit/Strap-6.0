'use strict';

const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '../public');
const destination = path.resolve(__dirname, '../dist');

function copy(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const from = path.join(directory, entry.name);
    const relative = path.relative(source, from);
    if (entry.isDirectory()) {
      copy(from);
      continue;
    }
    if (entry.name.endsWith('.html') || ['script.js', 'neon-auth.js'].includes(entry.name)) continue;
    const to = path.join(destination, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

copy(source);
