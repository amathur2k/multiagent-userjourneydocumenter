const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const EventEmitter = require('events');

class MCPClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      port: options.port || 3001,
      browser: options.browser || 'chrome',
      headless: options.headless !== undefined ? options.headless : false,
      timeout: options.timeout || 60000, // Increased timeout to 60 seconds
      userDataDir: options.userDataDir || null,
      executablePath: options.executablePath || null,
      vision: options.vision !== undefined ? options.vision : false,
      ...options
    };
    
    this.baseUrl = options.baseUrl || `http://localhost:${this.options.port}`;
    this.mcpProcess = null;
    this.isRunning = false;
    this.toolDefinitions = this._getPlaywrightToolDefinitions();
  }

  /**
   * Start the Playwright MCP server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      console.log('Playwright MCP server is already running');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Build the command arguments
        const args = ['@playwright/mcp'];
        
        // Add options
        if (this.options.browser) args.push('--browser', this.options.browser);
        if (this.options.headless) args.push('--headless');
        if (this.options.port) args.push('--port', this.options.port.toString());
        if (this.options.userDataDir) args.push('--user-data-dir', this.options.userDataDir);
        if (this.options.executablePath) args.push('--executable-path', this.options.executablePath);
        if (this.options.vision) args.push('--vision');
        
        console.log('Starting Playwright MCP server with command:', 'npx', args.join(' '));
        
        // Spawn the MCP server process
        this.mcpProcess = spawn('npx', args, {
          stdio: 'pipe',
          shell: true,
          windowsHide: false // Show window on Windows to help with debugging
        });
        
        // Log that we're attempting to start the server
        console.log(`Attempting to start Playwright MCP server (timeout: ${this.options.timeout}ms)...`);
        
        let outputBuffer = '';
        
        this.mcpProcess.stdout.on('data', (data) => {
          const output = data.toString();
          outputBuffer += output;
          console.log('[Playwright MCP]', output.trim());
          
          // Check if server is ready - look for various indicators
          if (output.includes('Server listening on port') || 
              output.includes('ready') || 
              output.includes('Listening on http://localhost') || 
              output.includes('Put this in your client config')) {
            this.isRunning = true;
            console.log('Playwright MCP server is running on port', this.options.port);
            this.emit('ready');
            resolve();
          }
        });
        
        this.mcpProcess.stderr.on('data', (data) => {
          const error = data.toString();
          console.error('[Playwright MCP Error]', error.trim());
          
          // If we haven't resolved yet, consider this an error in startup
          if (!this.isRunning) {
            reject(new Error(`Failed to start Playwright MCP server: ${error}`));
          }
        });
        
        this.mcpProcess.on('close', (code) => {
          if (code !== 0 && !this.isRunning) {
            reject(new Error(`Playwright MCP server exited with code ${code}`));
          } else if (this.isRunning) {
            this.isRunning = false;
            console.log('Playwright MCP server stopped');
            this.emit('stopped');
          }
        });
        
        // Set a timeout for server startup
        setTimeout(() => {
          if (!this.isRunning) {
            console.error(`Playwright MCP server failed to start within ${this.options.timeout}ms`);
            console.error('Output buffer so far:', outputBuffer);
            
            // Check if Playwright is installed
            this._checkPlaywrightInstallation()
              .then(installed => {
                if (!installed) {
                  console.error('Playwright MCP package may not be installed. Try running: npm install @playwright/mcp');
                }
                reject(new Error(`Playwright MCP server failed to start within ${this.options.timeout}ms`));
              })
              .catch(err => {
                console.error('Error checking Playwright installation:', err);
                reject(new Error(`Playwright MCP server failed to start within ${this.options.timeout}ms`));
              });
          }
        }, this.options.timeout);
        
      } catch (error) {
        reject(new Error(`Failed to start Playwright MCP server: ${error.message}`));
      }
    });
  }

  /**
   * Stop the Playwright MCP server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning || !this.mcpProcess) {
      return Promise.resolve();
    }
    
    return new Promise((resolve) => {
      this.mcpProcess.on('close', () => {
        this.isRunning = false;
        this.mcpProcess = null;
        console.log('Playwright MCP server stopped');
        resolve();
      });
      
      // Send SIGTERM to gracefully shut down
      this.mcpProcess.kill();
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.mcpProcess) {
          console.log('Forcing Playwright MCP server to stop');
          this.mcpProcess.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * Execute a tool via the Playwright MCP server
   * @param {string} toolName - The name of the tool to execute
   * @param {object} args - The arguments to pass to the tool
   * @returns {Promise<any>} - The result of the tool execution
   */
  async executeTool(toolName, args) {
    try {
      if (!this.isRunning) {
        console.log('Playwright MCP server is not running, starting it now...');
        await this.start();
      }
      
      console.log(`Executing Playwright MCP tool ${toolName} with args:`, args);
      
      // Format the tool name to match Playwright MCP format if needed
      const formattedToolName = toolName.startsWith('browser_') ? toolName : `browser_${toolName}`;
      
      // Make the request to the Playwright MCP server
      const endpoint = `${this.baseUrl}/api/tools/${formattedToolName}`;
      const response = await this._makeRequest('POST', endpoint, args);
      
      console.log(`Tool ${formattedToolName} execution result:`, response);
      return response;
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }

  /**
   * Make an HTTP request to the MCP server
   * @param {string} method - The HTTP method (GET, POST, etc.)
   * @param {string} url - The URL to make the request to
   * @param {object} data - The data to send with the request (for POST, PUT, etc.)
   * @returns {Promise<any>} - The response data
   */
  _makeRequest(method, url, data = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        method: method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: this.options.timeout
      };

      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsedData = responseData ? JSON.parse(responseData) : {};
              resolve(parsedData);
            } else {
              reject(new Error(`HTTP error ${res.statusCode}: ${responseData}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });
      
      req.on('timeout', () => {
        req.abort();
        reject(new Error(`Request timed out after ${this.options.timeout}ms`));
      });
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  /**
   * Get all tool definitions from Playwright MCP
   * @returns {Array} - Array of tool definitions
   */
  getToolDefinitions() {
    return this.toolDefinitions;
  }

  /**
   * Register tools with the tool registry
   * @param {ToolRegistry} toolRegistry - The tool registry to register tools with
   */
  registerTools(toolRegistry) {
    // Get the tools based on the mode
    let tools;
    
    if (this.options.vision) {
      // Vision mode - use base tools and vision-specific tools
      tools = [...this._getBaseTools(), ...this._getVisionTools()];
    } else {
      // Snapshot mode - use base tools only for now
      // Since _getSnapshotTools is not implemented, just use base tools
      tools = [...this._getBaseTools()];
    }
    
    // Validate and fix tool definitions before registering
    this._validateAndFixToolDefinitions(tools);
    
    // Register each tool with the registry
    tools.forEach(tool => {
      toolRegistry.registerTool(tool);
    });
    
    console.log(`Registered ${tools.length} Playwright MCP tools`);
  }
  
  /**
   * Validate and fix tool definitions to ensure they are compatible with Gemini API
   * @param {Array} tools - Array of tool definitions to validate and fix
   * @private
   */
  _validateAndFixToolDefinitions(tools) {
    for (const tool of tools) {
      if (!tool.parameters) continue;
      
      // Ensure type is set
      if (!tool.parameters.type) {
        tool.parameters.type = 'object';
      }
      
      // Process properties
      if (tool.parameters.properties) {
        Object.keys(tool.parameters.properties).forEach(propKey => {
          const prop = tool.parameters.properties[propKey];
          
          // Remove default field if present (not supported by Gemini API)
          if (prop.default !== undefined) {
            delete prop.default;
          }
          
          // Add items field to array properties if missing
          if (prop.type === 'array' && !prop.items) {
            prop.items = {
              type: 'string'
            };
            console.log(`Added missing items field to array property: ${propKey} in tool ${tool.name}`);
          }
          
          // Process items for arrays
          if (prop.items && typeof prop.items === 'object') {
            // Remove default field from items if present
            if (prop.items.default !== undefined) {
              delete prop.items.default;
            }
            
            // Ensure items has a type
            if (!prop.items.type) {
              prop.items.type = 'string';
            }
          }
        });
      }
    }
  }

  /**
   * Get Playwright MCP tool definitions
   * @private
   * @returns {Array} - Array of tool definitions
   */
  _getPlaywrightToolDefinitions() {
    // Get base tools available in both snapshot and vision modes
    const baseTools = this._getBaseTools();
    
    // Add vision-specific tools if vision mode is enabled
    const visionTools = this.options.vision ? this._getVisionTools() : [];
    
    // Combine and return all tools
    return [...baseTools, ...visionTools];
  }
  
  /**
   * Get base tools available in both snapshot and vision modes
   * @private
   * @returns {Array} - Array of base tool definitions
   */
  _getBaseTools() {
    // These are the tools available in both snapshot and vision modes
    // Note: Removed all default values as they're not supported by Gemini API
    return [
      {
        name: 'browser_navigate',
        description: 'Navigate to a URL',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'browser_navigate_back',
        description: 'Go back to the previous page',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_navigate_forward',
        description: 'Go forward to the next page',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_snapshot',
        description: 'Capture accessibility snapshot of the current page',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_take_screenshot',
        description: 'Take a screenshot of the current page',
        parameters: {
          type: 'object',
          properties: {
            raw: {
              type: 'boolean',
              description: 'Whether to return without compression (in PNG format)'
            }
          }
        }
      },
      {
        name: 'browser_click',
        description: 'Perform click on a web page',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            ref: {
              type: 'string',
              description: 'Exact target element reference from the page snapshot'
            }
          },
          required: ['element', 'ref']
        }
      },
      {
        name: 'browser_hover',
        description: 'Hover over element on page',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            ref: {
              type: 'string',
              description: 'Exact target element reference from the page snapshot'
            }
          },
          required: ['element', 'ref']
        }
      },
      {
        name: 'browser_type',
        description: 'Type text into editable element',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            ref: {
              type: 'string',
              description: 'Exact target element reference from the page snapshot'
            },
            text: {
              type: 'string',
              description: 'Text to type into the element'
            },
            submit: {
              type: 'boolean',
              description: 'Whether to submit entered text (press Enter after)'
            },
            slowly: {
              type: 'boolean',
              description: 'Whether to type one character at a time'
            }
          },
          required: ['element', 'ref', 'text']
        }
      },
      {
        name: 'browser_select_option',
        description: 'Select an option in a dropdown',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            ref: {
              type: 'string',
              description: 'Exact target element reference from the page snapshot'
            },
            values: {
              type: 'array',
              description: 'Array of values to select in the dropdown',
              items: {
                type: 'string'
              }
            }
          },
          required: ['element', 'ref', 'values']
        }
      },
      {
        name: 'browser_press_key',
        description: 'Press a key on the keyboard',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Name of the key to press or a character to generate'
            }
          },
          required: ['key']
        }
      },
      {
        name: 'browser_console_messages',
        description: 'Returns all console messages',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_file_upload',
        description: 'Choose one or multiple files to upload',
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              description: 'The absolute paths to the files to upload',
              items: {
                type: 'string'
              }
            }
          },
          required: ['paths']
        }
      },
      {
        name: 'browser_pdf_save',
        description: 'Save page as PDF',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_wait',
        description: 'Wait for a specified time in seconds',
        parameters: {
          type: 'object',
          properties: {
            time: {
              type: 'number',
              description: 'The time to wait in seconds (capped at 10 seconds)'
            }
          },
          required: ['time']
        }
      },
      {
        name: 'browser_close',
        description: 'Close the page',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_install',
        description: 'Install the browser specified in the config',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_tab_list',
        description: 'List browser tabs',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_tab_new',
        description: 'Open a new tab',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to in the new tab'
            }
          }
        }
      },
      {
        name: 'browser_tab_select',
        description: 'Select a tab by index',
        parameters: {
          type: 'object',
          properties: {
            index: {
              type: 'number',
              description: 'The index of the tab to select'
            }
          },
          required: ['index']
        }
      },
      {
        name: 'browser_tab_close',
        description: 'Close a tab',
        parameters: {
          type: 'object',
          properties: {
            index: {
              type: 'number',
              description: 'The index of the tab to close'
            }
          }
        }
      }
    ];
  }
  
  /**
   * Get vision-specific tools
   * @private
   * @returns {Array} - Array of vision tool definitions
   */
  _getVisionTools() {
    // These tools are only available in vision mode
    return [
      {
        name: 'browser_screen_capture',
        description: 'Take a screenshot of the current page',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_screen_click',
        description: 'Click left mouse button at specific coordinates',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            x: {
              type: 'number',
              description: 'X coordinate'
            },
            y: {
              type: 'number',
              description: 'Y coordinate'
            }
          },
          required: ['element', 'x', 'y']
        }
      },
      {
        name: 'browser_screen_move_mouse',
        description: 'Move mouse to a given position',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            x: {
              type: 'number',
              description: 'X coordinate'
            },
            y: {
              type: 'number',
              description: 'Y coordinate'
            }
          },
          required: ['element', 'x', 'y']
        }
      },
      {
        name: 'browser_screen_drag',
        description: 'Drag left mouse button from one position to another',
        parameters: {
          type: 'object',
          properties: {
            element: {
              type: 'string',
              description: 'Human-readable element description'
            },
            startX: {
              type: 'number',
              description: 'Start X coordinate'
            },
            startY: {
              type: 'number',
              description: 'Start Y coordinate'
            },
            endX: {
              type: 'number',
              description: 'End X coordinate'
            },
            endY: {
              type: 'number',
              description: 'End Y coordinate'
            }
          },
          required: ['element', 'startX', 'startY', 'endX', 'endY']
        }
      },
      {
        name: 'browser_screen_type',
        description: 'Type text at the current cursor position',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to type'
            },
            submit: {
              type: 'boolean',
              description: 'Whether to submit entered text (press Enter after)'
            }
          },
          required: ['text']
        }
      }
    ];
  }
  /**
   * Check if Playwright MCP is installed
   * @returns {Promise<boolean>} - True if installed, false otherwise
   * @private
   */
  async _checkPlaywrightInstallation() {
    return new Promise((resolve) => {
      const checkProcess = spawn('npx', ['--no-install', 'playwright', '--version'], {
        stdio: 'pipe',
        shell: true
      });
      
      let output = '';
      
      checkProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      checkProcess.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      checkProcess.on('close', (code) => {
        if (code === 0 && output.includes('Version')) {
          console.log('Playwright is installed:', output.trim());
          resolve(true);
        } else {
          console.error('Playwright installation check failed:', output);
          resolve(false);
        }
      });
    });
  }
}

module.exports = { MCPClient };
