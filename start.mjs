#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

console.log('🌱 EcoBloom Solar Park Launcher');
console.log(`OS: ${process.platform} | Node: ${process.version}`);

function runCommand(command, args, callback) {
  const child = spawn(command, args, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: isWindows,
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Command "${command} ${args.join(' ')}" exited with code ${code}`);
      process.exit(code ?? 1);
    }
    if (callback) callback();
  });

  child.on('error', (err) => {
    console.error(`Failed to start "${command}":`, err);
    process.exit(1);
  });
}

const nodeModulesExist = existsSync(resolve(__dirname, 'node_modules'));
const threeExists = existsSync(resolve(__dirname, 'node_modules', 'three'));

if (!nodeModulesExist || !threeExists) {
  console.log('📦 Installing dependencies (npm install)...');
  runCommand(npmCmd, ['install'], startDevServer);
} else {
  startDevServer();
}

function startDevServer() {
  console.log('\n🚀 Starting Vite development server...');
  console.log('------------------------------------------------------------');
  console.log('  🌿 EcoBloom Solar Park Simulator: http://localhost:5173/');
  console.log('------------------------------------------------------------\n');

  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: isWindows,
  });

  const forwardSignal = (signal) => {
    if (child && !child.killed) {
      child.kill(signal);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
}
