const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Agent } = require('./agent');
const { MCPClient } = require('./mcpClient');
const { ToolRegistry } = require('./toolRegistry');

class AgentSystem {
  constructor() {
    // Initialize the Google Generative AI client
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Initialize the MCP client for tool execution with Playwright
    this.mcpClient = new MCPClient({
      port: process.env.MCP_PORT || 3001,
      browser: process.env.MCP_BROWSER || 'chrome',
      headless: process.env.MCP_HEADLESS === 'true',
      vision: process.env.MCP_VISION === 'true'
    });
    
    // Initialize the tool registry with the MCP client
    this.toolRegistry = new ToolRegistry(this.mcpClient);
    
    // Create agent instances for different roles
    this.agents = {
      thinker: new Agent('thinker', this.genAI, this.toolRegistry, this.mcpClient),
      planner: new Agent('planner', this.genAI, this.toolRegistry, this.mcpClient),
      reviewer: new Agent('reviewer', this.genAI, this.toolRegistry, this.mcpClient),
      executor: new Agent('executor', this.genAI, this.toolRegistry, this.mcpClient)
    };
    
    // Task management
    this.tasks = new Map();
    
    // Client connections for SSE
    this.clients = new Map();
    
    // Initialize the MCP client
    this._initializeMCPClient();
  }
  
  /**
   * Initialize the MCP client
   * @private
   */
  async _initializeMCPClient() {
    try {
      console.log('Starting Playwright MCP client...');
      await this.mcpClient.start();
      console.log('Playwright MCP client started successfully');
    } catch (error) {
      console.error('Failed to start Playwright MCP client:', error);
    }
  }
  
  // Register a client for SSE
  registerClient(clientId, sendFunction) {
    this.clients.set(clientId, sendFunction);
    console.log(`Client ${clientId} registered for SSE updates`);
  }
  
  // Unregister a client
  unregisterClient(clientId) {
    this.clients.delete(clientId);
    console.log(`Client ${clientId} unregistered from SSE updates`);
  }
  
  // Send update to all connected clients
  broadcastUpdate(update) {
    for (const sendFn of this.clients.values()) {
      sendFn(update);
    }
  }
  
  // Start a new task with the multi-agent system
  async startTask(prompt, availableTools = []) {
    const taskId = Date.now().toString();
    
    // Register any tools provided for this task
    for (const tool of availableTools) {
      this.toolRegistry.registerTool(tool);
    }
    
    // Create a new task object
    const task = {
      id: taskId,
      prompt,
      status: 'thinking',
      history: [],
      result: null,
      startTime: Date.now(),
      endTime: null
    };
    
    // Store the task
    this.tasks.set(taskId, task);
    
    // Broadcast task started
    this.broadcastUpdate({
      type: 'task_started',
      taskId,
      status: task.status
    });
    
    // Start the agent workflow asynchronously
    this._executeAgentWorkflow(taskId).catch(error => {
      console.error(`Error in agent workflow for task ${taskId}:`, error);
      this._updateTaskStatus(taskId, 'failed', { error: error.message });
    });
    
    return taskId;
  }
  
  // Get the status of a task
  async getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return {
      id: task.id,
      status: task.status,
      result: task.result,
      history: task.history,
      startTime: task.startTime,
      endTime: task.endTime
    };
  }
  
  // Execute the multi-agent workflow
  async _executeAgentWorkflow(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    try {
      // Step 1: Thinking phase
      await this._updateTaskStatus(taskId, 'thinking');
      const thinkingResult = await this.agents.thinker.process({
        input: task.prompt,
        context: "You are the thinking agent. Your job is to analyze the user's request, understand the requirements, and identify key aspects that need to be addressed."
      });
      
      task.history.push({
        phase: 'thinking',
        output: thinkingResult,
        timestamp: Date.now()
      });
      
      // Step 2: Planning phase
      await this._updateTaskStatus(taskId, 'planning');
      const planningResult = await this.agents.planner.process({
        input: task.prompt,
        context: "You are the planning agent. Based on the thinking agent's analysis, create a step-by-step plan to accomplish the task.",
        previousSteps: [{ role: 'thinking', content: thinkingResult }]
      });
      
      task.history.push({
        phase: 'planning',
        output: planningResult,
        timestamp: Date.now()
      });
      
      // Step 3: Execution phase
      await this._updateTaskStatus(taskId, 'executing');
      const executionResult = await this.agents.executor.process({
        input: task.prompt,
        context: "You are the executor agent. Execute the plan created by the planning agent, using tools when necessary.",
        previousSteps: [
          { role: 'thinking', content: thinkingResult },
          { role: 'planning', content: planningResult }
        ]
      });
      
      task.history.push({
        phase: 'executing',
        output: executionResult,
        timestamp: Date.now()
      });
      
      // Step 4: Review phase
      await this._updateTaskStatus(taskId, 'reviewing');
      const reviewResult = await this.agents.reviewer.process({
        input: task.prompt,
        context: "You are the reviewer agent. Review the execution results, identify any issues, and suggest improvements.",
        previousSteps: [
          { role: 'thinking', content: thinkingResult },
          { role: 'planning', content: planningResult },
          { role: 'executing', content: executionResult }
        ]
      });
      
      task.history.push({
        phase: 'reviewing',
        output: reviewResult,
        timestamp: Date.now()
      });
      
      // Mark task as completed
      await this._updateTaskStatus(taskId, 'completed', {
        thinking: thinkingResult,
        planning: planningResult,
        execution: executionResult,
        review: reviewResult,
        finalResult: reviewResult // The review is considered the final result
      });
      
    } catch (error) {
      console.error(`Error in agent workflow for task ${taskId}:`, error);
      await this._updateTaskStatus(taskId, 'failed', { error: error.message });
      throw error;
    }
  }
  
  // Update task status and broadcast to clients
  async _updateTaskStatus(taskId, status, result = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    task.status = status;
    if (result) {
      task.result = result;
    }
    
    if (status === 'completed' || status === 'failed') {
      task.endTime = Date.now();
    }
    
    // Broadcast status update
    this.broadcastUpdate({
      type: 'task_update',
      taskId,
      status,
      result: result,
      timestamp: Date.now()
    });
  }
}

module.exports = { AgentSystem };
