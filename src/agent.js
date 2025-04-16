class Agent {
  constructor(role, genAI, toolRegistry, mcpClient) {
    this.role = role;
    this.genAI = genAI;
    this.toolRegistry = toolRegistry;
    this.mcpClient = mcpClient;
    this.model = genAI.getGenerativeModel({ model: "gemini-2.5-pro-exp-03-25" });
  }

  async process({ input, context, previousSteps = [] }) {
    try {
      console.log(`${this.role} agent processing input: ${input.substring(0, 50)}...`);
      
      // Build the prompt with context and previous steps
      const prompt = this._buildPrompt(input, context, previousSteps);
      
      // Get available tools for this agent
      const tools = this.toolRegistry.getToolsForAgent(this.role);
      
      // Log available tools for this agent
      console.log(`${this.role} agent has access to ${tools.length} tools:`, 
        tools.map(t => t.name).join(', '));
      
      // Configure the model with tool definitions if available
      const generationConfig = {
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 8192,
      };
      
      let chat;
      if (tools && tools.length > 0) {
        // First, ensure all tool definitions have proper items fields for arrays
        this._fixToolDefinitions(tools);
        
        // Prepare tool declarations for the model
        const functionDeclarations = tools.map(tool => {
          return {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          };
        });
        
        // Validate function declarations before sending to Gemini API
        this._validateFunctionDeclarations(functionDeclarations);
        
        // Configure model with tools
        chat = this.model.startChat({
          generationConfig,
          tools: [{
            functionDeclarations
          }]
        });
        
        // Log the number of tools configured for the model
        console.log(`${this.role} agent configured with ${functionDeclarations.length} tools`);
      } else {
        // No tools needed
        chat = this.model.startChat({
          generationConfig
        });
      }
      
      // Send the message to the model
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const text = response.text();
      
      // Handle any tool calls in the response
      if (response.functionCalls && response.functionCalls.length > 0) {
        const toolResults = await this._handleToolCalls(response.functionCalls);
        
        // Send the tool results back to the model
        const followupResult = await chat.sendMessage(
          `Tool execution results: ${JSON.stringify(toolResults)}`
        );
        
        // Combine the original response with the tool-informed response
        return text + "\n\n" + followupResult.response.text();
      }
      
      return text;
    } catch (error) {
      console.error(`Error in ${this.role} agent:`, error);
      throw new Error(`${this.role} agent failed: ${error.message}`);
    }
  }
  
  // Build the prompt for the agent based on role, input, context, and previous steps
  _buildPrompt(input, context, previousSteps) {
    let prompt = `${context}\n\n`;
    
    // Add previous steps from other agents
    if (previousSteps.length > 0) {
      prompt += "Previous steps:\n";
      for (const step of previousSteps) {
        prompt += `\n## ${step.role.toUpperCase()} AGENT OUTPUT:\n${step.content}\n`;
      }
      prompt += "\n";
    }
    
    // Add the current task
    prompt += `Task: ${input}\n\n`;
    
    // Add role-specific instructions
    switch (this.role) {
      case 'thinker':
        prompt += "Analyze the task, break it down into components, and identify key aspects that need to be addressed. Don't solve the problem yet, just understand it deeply.";
        break;
      case 'planner':
        prompt += "Based on the thinking analysis, create a detailed step-by-step plan to accomplish the task. Be specific about what needs to be done at each step.";
        break;
      case 'executor':
        prompt += "Execute the plan created by the planning agent. Use tools when necessary. Show your work and explain what you're doing at each step.";
        break;
      case 'reviewer':
        prompt += "Review the execution results, identify any issues or potential improvements, and provide a final assessment of the solution.";
        break;
      default:
        prompt += "Process the input and provide a thoughtful response.";
    }
    
    return prompt;
  }
  
  // Handle tool calls from the model
  async _handleToolCalls(functionCalls) {
    const results = [];
    
    for (const functionCall of functionCalls) {
      const { name, args } = functionCall;
      console.log(`${this.role} agent calling tool: ${name} with args:`, args);
      
      try {
        // Execute the tool via MCP client
        const result = await this.mcpClient.executeTool(name, args);
        
        // Process the result based on the tool type
        let processedResult = result;
        
        // Special handling for screenshot/snapshot tools
        if (name === 'browser_screen_capture' || name === 'browser_snapshot' || name === 'browser_take_screenshot') {
          // For screenshots, we'll include a message about the image being captured
          processedResult = {
            message: `Screenshot captured successfully. ${result.data ? 'Image data is available.' : ''}`,
            ...result
          };
          
          // Log that we captured a screenshot/snapshot
          console.log(`${this.role} agent captured a ${name === 'browser_snapshot' ? 'snapshot' : 'screenshot'} of the page`);
        }
        
        // Add the result to our results array
        results.push({
          tool: name,
          args,
          result: processedResult,
          status: 'success'
        });
        
        // Log success
        console.log(`Tool ${name} executed successfully`);
      } catch (error) {
        console.error(`Error executing tool ${name}:`, error);
        results.push({
          tool: name,
          args,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    return results;
  }
  /**
   * Clean parameters object for Gemini API compatibility
   * Removes unsupported fields like 'default' values and adds required fields for arrays
   * @param {object} parameters - The parameters object to clean
   * @returns {object} - Cleaned parameters object
   * @private
   */
  _cleanParametersForGemini(parameters) {
    // Create a deep copy to avoid modifying the original
    const cleanParams = JSON.parse(JSON.stringify(parameters));
    
    // Process properties recursively if they exist
    if (cleanParams.properties) {
      Object.keys(cleanParams.properties).forEach(propKey => {
        const prop = cleanParams.properties[propKey];
        
        // Remove default field if present
        if (prop.default !== undefined) {
          delete prop.default;
        }
        
        // Add items field to array properties if missing
        if (prop.type === 'array' && !prop.items) {
          // Add a default items field with string type
          prop.items = {
            type: 'string'
          };
          console.log(`Added missing items field to array property: ${propKey}`);
        }
        
        // Process nested properties recursively
        if (prop.properties) {
          cleanParams.properties[propKey] = this._cleanParametersForGemini(prop);
        }
        
        // Process items for arrays
        if (prop.items && typeof prop.items === 'object') {
          if (prop.items.default !== undefined) {
            delete prop.items.default;
          }
          
          // Process nested properties in items
          if (prop.items.properties) {
            prop.items = this._cleanParametersForGemini(prop.items);
          }
        }
      });
    }
    
    return cleanParams;
  }
  /**
   * Fix tool definitions to ensure they are compatible with Gemini API
   * @param {Array} tools - Array of tool definitions to fix
   * @private
   */
  _fixToolDefinitions(tools) {
    for (const tool of tools) {
      if (!tool.parameters) continue;
      
      // Fix the parameters object
      this._fixParametersObject(tool.parameters);
      
      // Log that we fixed the tool
      console.log(`Fixed tool definition for ${tool.name}`);
    }
  }
  
  /**
   * Fix a parameters object to ensure it's compatible with Gemini API
   * @param {object} parameters - Parameters object to fix
   * @private
   */
  _fixParametersObject(parameters) {
    if (!parameters || typeof parameters !== 'object') return;
    
    // Ensure type is set
    if (!parameters.type) {
      parameters.type = 'object';
    }
    
    // Process properties
    if (parameters.properties) {
      Object.keys(parameters.properties).forEach(propKey => {
        const prop = parameters.properties[propKey];
        
        // Remove default field if present
        if (prop.default !== undefined) {
          delete prop.default;
        }
        
        // Add items field to array properties if missing
        if (prop.type === 'array' && !prop.items) {
          prop.items = {
            type: 'string'
          };
          console.log(`Added missing items field to array property: ${propKey}`);
        }
        
        // Process nested properties recursively
        if (prop.properties) {
          this._fixParametersObject(prop);
        }
        
        // Process items for arrays
        if (prop.items && typeof prop.items === 'object') {
          // Remove default field from items if present
          if (prop.items.default !== undefined) {
            delete prop.items.default;
          }
          
          // Process nested properties in items
          if (prop.items.properties) {
            this._fixParametersObject(prop.items);
          }
        }
      });
    }
  }
  
  /**
   * Validate function declarations before sending to Gemini API
   * @param {Array} functionDeclarations - Array of function declarations to validate
   * @private
   */
  _validateFunctionDeclarations(functionDeclarations) {
    for (const func of functionDeclarations) {
      // Check for required fields
      if (!func.name) {
        console.error('Function declaration missing name');
      }
      
      if (!func.parameters) {
        console.error(`Function ${func.name} missing parameters`);
        continue;
      }
      
      // Check parameters object
      const params = func.parameters;
      
      // Ensure type is set
      if (!params.type) {
        console.error(`Function ${func.name} parameters missing type`);
        params.type = 'object';
      }
      
      // Check properties
      if (params.properties) {
        Object.keys(params.properties).forEach(propKey => {
          const prop = params.properties[propKey];
          
          // Check property type
          if (!prop.type) {
            console.error(`Function ${func.name} property ${propKey} missing type`);
            prop.type = 'string';
          }
          
          // Check array properties
          if (prop.type === 'array') {
            if (!prop.items) {
              console.error(`Function ${func.name} array property ${propKey} missing items`);
              prop.items = { type: 'string' };
            } else if (!prop.items.type) {
              console.error(`Function ${func.name} array property ${propKey} items missing type`);
              prop.items.type = 'string';
            }
          }
        });
      }
    }
  }
}

module.exports = { Agent };
