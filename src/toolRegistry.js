class ToolRegistry {
  constructor(mcpClient) {
    // Map to store registered tools
    this.tools = new Map();
    
    // Map to store agent-specific tool permissions
    this.agentTools = new Map();
    
    // Store the MCP client reference
    this.mcpClient = mcpClient;
    
    // Register default tools
    this._registerDefaultTools();
  }
  
  /**
   * Register a new tool
   * @param {object} tool - The tool definition
   * @param {string} tool.name - The name of the tool
   * @param {string} tool.description - Description of what the tool does
   * @param {object} tool.parameters - JSON Schema for the tool parameters
   * @param {string[]} tool.allowedAgents - Array of agent roles allowed to use this tool (optional)
   */
  registerTool(tool) {
    if (!tool.name || !tool.description || !tool.parameters) {
      throw new Error('Tool must have name, description, and parameters');
    }
    
    // Register the tool
    this.tools.set(tool.name, tool);
    
    // Register agent permissions for this tool
    const allowedAgents = tool.allowedAgents || ['executor']; // Default: only executor can use tools
    for (const agent of allowedAgents) {
      if (!this.agentTools.has(agent)) {
        this.agentTools.set(agent, new Set());
      }
      this.agentTools.get(agent).add(tool.name);
    }
    
    console.log(`Registered tool: ${tool.name}`);
    return true;
  }
  
  /**
   * Get all available tools
   * @returns {object[]} - Array of tool definitions
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }
  
  /**
   * Get tools available for a specific agent role
   * @param {string} agentRole - The role of the agent
   * @returns {object[]} - Array of tool definitions available to this agent
   */
  getToolsForAgent(agentRole) {
    if (!this.agentTools.has(agentRole)) {
      return [];
    }
    
    const toolNames = Array.from(this.agentTools.get(agentRole));
    return toolNames.map(name => this.tools.get(name)).filter(Boolean);
  }
  
  /**
   * Check if a tool exists
   * @param {string} toolName - The name of the tool
   * @returns {boolean} - True if the tool exists
   */
  hasTool(toolName) {
    return this.tools.has(toolName);
  }
  
  /**
   * Get a specific tool by name
   * @param {string} toolName - The name of the tool
   * @returns {object|null} - The tool definition or null if not found
   */
  getTool(toolName) {
    return this.tools.get(toolName) || null;
  }
  
  /**
   * Remove a tool from the registry
   * @param {string} toolName - The name of the tool to remove
   * @returns {boolean} - True if the tool was removed
   */
  unregisterTool(toolName) {
    if (!this.tools.has(toolName)) {
      return false;
    }
    
    // Remove from tools map
    this.tools.delete(toolName);
    
    // Remove from agent permissions
    for (const [agent, toolSet] of this.agentTools.entries()) {
      if (toolSet.has(toolName)) {
        toolSet.delete(toolName);
      }
    }
    
    console.log(`Unregistered tool: ${toolName}`);
    return true;
  }
  
  /**
   * Register default tools available to the system
   * @private
   */
  _registerDefaultTools() {
    // If we have an MCP client, register Playwright MCP tools
    if (this.mcpClient) {
      this._registerPlaywrightMCPTools();
    }
    
    // Register additional custom tools
    
    // Web search tool
    this.registerTool({
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          num_results: {
            type: 'integer',
            description: 'Number of results to return',
            default: 5
          }
        },
        required: ['query']
      },
      allowedAgents: ['executor', 'thinker'] // Both executor and thinker can search
    });
    
    // File read tool
    this.registerTool({
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to read'
          }
        },
        required: ['path']
      },
      allowedAgents: ['executor'] // Only executor can read files
    });
    
    // File write tool
    this.registerTool({
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to write'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          },
          append: {
            type: 'boolean',
            description: 'Whether to append to the file or overwrite it',
            default: false
          }
        },
        required: ['path', 'content']
      },
      allowedAgents: ['executor'] // Only executor can write files
    });
    
    // Run command tool
    this.registerTool({
      name: 'run_command',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to run'
          },
          cwd: {
            type: 'string',
            description: 'The working directory to run the command in',
            default: '.'
          }
        },
        required: ['command']
      },
      allowedAgents: ['executor'] // Only executor can run commands
    });
  }
  
  /**
   * Register Playwright MCP tools
   * @private
   */
  _registerPlaywrightMCPTools() {
    if (!this.mcpClient) {
      console.warn('No MCP client available to register Playwright tools');
      return;
    }
    
    // Get tool definitions from the MCP client
    const playwrightTools = this.mcpClient.getToolDefinitions();
    
    // Register each tool with appropriate agent permissions
    for (const tool of playwrightTools) {
      // Determine which agents can use this tool
      let allowedAgents = ['executor'];
      
      // Define which tools can be used by which agents
      switch (tool.name) {
        // Tools that can be used by all agents
        case 'browser_navigate':
        case 'browser_snapshot':
        case 'browser_take_screenshot':
        case 'browser_screen_capture':
          allowedAgents = ['executor', 'thinker', 'planner', 'reviewer'];
          break;
          
        // Navigation and tab management tools - available to executor and planner
        case 'browser_navigate_back':
        case 'browser_navigate_forward':
        case 'browser_tab_list':
        case 'browser_tab_new':
        case 'browser_tab_select':
        case 'browser_tab_close':
          allowedAgents = ['executor', 'planner'];
          break;
        
        // Utility tools - available to executor
        case 'browser_wait':
        case 'browser_close':
        case 'browser_install':
        case 'browser_press_key':
        case 'browser_console_messages':
        case 'browser_pdf_save':
        case 'browser_file_upload':
          allowedAgents = ['executor'];
          break;
          
        // Vision-based interaction tools - only available to executor
        case 'browser_screen_click':
        case 'browser_screen_move_mouse':
        case 'browser_screen_drag':
        case 'browser_screen_type':
          allowedAgents = ['executor'];
          break;
          
        // Default - only executor can use the tool
        default:
          allowedAgents = ['executor'];
          break;
      }
      
      // Register the tool
      this.registerTool({
        ...tool,
        allowedAgents
      });
    }
    
    console.log(`Registered ${playwrightTools.length} Playwright MCP tools`);
  }
}

module.exports = { ToolRegistry };
