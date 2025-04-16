const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Check if API key is set
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_api_key_here') {
  console.log('\x1b[33m%s\x1b[0m', 'WARNING: Gemini API key not set in .env file');
  console.log('Please set your Gemini API key in the .env file before starting the server.');
  console.log('You can get an API key from https://ai.google.dev/');
  
  // Check if running in interactive mode
  if (process.stdout.isTTY) {
    console.log('\nWould you like to continue anyway? (y/n)');
    process.stdin.once('data', (data) => {
      const input = data.toString().trim().toLowerCase();
      if (input === 'y' || input === 'yes') {
        startServer();
      } else {
        console.log('Exiting...');
        process.exit(0);
      }
    });
  } else {
    console.log('Continuing without API key (system will not function correctly)...');
    startServer();
  }
} else {
  startServer();
}

function startServer() {
  console.log('\x1b[36m%s\x1b[0m', '🚀 Starting Multi-Agent System with Gemini 2.5 Pro');
  console.log('\x1b[36m%s\x1b[0m', '🌐 Starting Server...');
  
  // Start Main Server
  const mainServer = spawn('node', ['server.js'], {
    stdio: 'pipe',
    shell: true
  });
  
  mainServer.stdout.on('data', (data) => {
    console.log('\x1b[34m[Server]\x1b[0m', data.toString().trim());
  });
  
  mainServer.stderr.on('data', (data) => {
    console.error('\x1b[31m[Server Error]\x1b[0m', data.toString().trim());
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\n\x1b[36m%s\x1b[0m', '🛑 Shutting down server...');
    mainServer.kill();
    process.exit(0);
  });
}
