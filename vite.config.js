'use strict';

const path = require('path');
const fs = require('fs');
const { defineConfig } = require('vite');

const pages = Object.fromEntries(
  fs.readdirSync(path.resolve(__dirname, 'public'))
    .filter(file => file.endsWith('.html'))
    .map(file => [file.slice(0, -5), path.resolve(__dirname, 'public', file)])
);

module.exports = defineConfig({
  root: path.resolve(__dirname, 'public'),
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: pages }
  }
});
