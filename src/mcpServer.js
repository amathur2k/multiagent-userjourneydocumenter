const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class MCPServer {
  constructor(options = {}) {
    this.port = options.port || 3001;
    this.app = express();
    this.tools = new Map();
    
    // Middleware
    this.app.use(cors());
    this.app.use(bodyParser.json());
    
    // Register routes
    this._registerRoutes();
    
    // Register default tool implementations
    this._registerDefaultTools();
  }
  
  /**
   * Start the MCP server
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`MCP Server running on port ${this.port}`);
        resolve();
      });
    });
  }
  
  /**
   * Stop the MCP server
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('MCP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  /**
   * Register a new tool implementation
   * @param {string} name - The name of the tool
   * @param {Function} implementation - The implementation function
   */
  registerTool(name, implementation) {
    if (typeof implementation !== 'function') {
      throw new Error('Tool implementation must be a function');
    }
    
    this.tools.set(name, implementation);
    console.log(`Registered tool implementation: ${name}`);
  }
  
  /**
   * Register Express routes
   * @private
   */
  _registerRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
    
    // List available tools
    this.app.get('/api/tools', (req, res) => {
      res.json({
        tools: Array.from(this.tools.keys())
      });
    });
    
    // Execute a tool
    this.app.post('/api/tools/:toolName', async (req, res) => {
      const { toolName } = req.params;
      const args = req.body;
      
      console.log(`Tool execution request: ${toolName}`, args);
      
      if (!this.tools.has(toolName)) {
        return res.status(404).json({
          error: `Tool '${toolName}' not found`
        });
      }
      
      try {
        const implementation = this.tools.get(toolName);
        const result = await implementation(args);
        
        res.json({
          tool: toolName,
          args,
          result
        });
      } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        res.status(500).json({
          error: `Tool execution failed: ${error.message}`,
          tool: toolName,
          args
        });
      }
    });
  }
  
  /**
   * Register default tool implementations
   * @private
   */
  _registerDefaultTools() {
    // Web search tool (mock implementation)
    this.registerTool('web_search', async (args) => {
      const { query, num_results = 5 } = args;
      
      console.log(`Searching web for: ${query}`);
      
      // Mock implementation - in a real scenario, this would call a search API
      return {
        query,
        results: [
          { title: 'Example search result 1', snippet: 'This is a mock search result for: ' + query },
          { title: 'Example search result 2', snippet: 'Another mock search result for: ' + query },
          { title: 'Example search result 3', snippet: 'Yet another mock result for: ' + query }
        ].slice(0, num_results)
      };
    });
    
    // File read tool
    this.registerTool('read_file', async (args) => {
      const { path: filePath } = args;
      
      console.log(`Reading file: ${filePath}`);
      
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return { content };
      } catch (error) {
        throw new Error(`Failed to read file: ${error.message}`);
      }
    });
    
    // File write tool
    this.registerTool('write_file', async (args) => {
      const { path: filePath, content, append = false } = args;
      
      console.log(`Writing to file: ${filePath}`);
      
      try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write or append to file
        if (append) {
          fs.appendFileSync(filePath, content);
        } else {
          fs.writeFileSync(filePath, content);
        }
        
        return { success: true, path: filePath };
      } catch (error) {
        throw new Error(`Failed to write file: ${error.message}`);
      }
    });
    
    // Run command tool
    this.registerTool('run_command', async (args) => {
      const { command, cwd = '.' } = args;
      
      console.log(`Running command: ${command} in ${cwd}`);
      
      return new Promise((resolve, reject) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Command failed: ${error.message}\n${stderr}`));
            return;
          }
          
          resolve({
            stdout,
            stderr,
            exitCode: 0
          });
        });
      });
    });
  }
}

// Create and start the MCP server if this file is run directly
if (require.main === module) {
  const mcpServer = new MCPServer();
  mcpServer.start().catch(console.error);
}

module.exports = { MCPServer };
