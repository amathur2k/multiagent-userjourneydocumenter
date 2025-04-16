const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Agent } = require('./src/agent');
const { ToolRegistry } = require('./src/toolRegistry');
const { MCPClient } = require('./src/mcpClient');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
require('dotenv').config();

// Set environment variables for vision mode and non-headless mode
process.env.MCP_VISION = 'true';
process.env.MCP_HEADLESS = 'false';

// Function to log with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const taskInput = args.join(' ') || 'Navigate to the page at https://www.bluestone.com/jewellery/pendants.html and find a product details page and click to it. After landing on the product page attempt to buy it. Always use screenshots and visual inspection to find the best actions.';

// Configure the MCP client
const mcpClient = new MCPClient({
  port: process.env.MCP_PORT || 9090, // Use port 9090 to avoid conflicts
  browser: process.env.MCP_BROWSER || 'chrome',
  headless: false, // Always run in non-headless mode (visible browser)
  vision: true, // Always use vision mode
  timeout: 60000 // 60 seconds timeout
});

// Function to log with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Function to ensure the Playwright MCP server is running
async function ensurePlaywrightMCPServerRunning() {
  log('Ensuring Playwright MCP server is running in vision mode...');
  
  // Check if the server is already running on the specified port
  const isPortInUse = await checkIfPortInUse(mcpClient.options.port);
  
  if (isPortInUse) {
    log(`Playwright MCP server already running on port ${mcpClient.options.port}`);
    return true;
  }
  
  // Start the Playwright MCP server
  log('Starting Playwright MCP server...');
  return mcpClient.start();
}

// Function to check if a port is in use
async function checkIfPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        tester.close();
        resolve(false);
      })
      .listen(port);
  });
}

// Create a custom AgentSystem that uses our MCPClient
class CustomAgentSystem {
  constructor(mcpClient) {
    // Initialize the Google Generative AI client
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Use the provided MCP client
    this.mcpClient = mcpClient;
    
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
  }
  
  // Start a new task
  startTask(prompt) {
    const taskId = Date.now().toString();
    this.tasks.set(taskId, {
      id: taskId,
      prompt,
      status: 'pending',
      history: [],
      startTime: Date.now(),
      endTime: null,
      result: null
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
      log('Starting thinking phase...');
      let thinkingResult;
      try {
        thinkingResult = await this.agents.thinker.process({
          input: task.prompt,
          context: "You are the thinking agent. Your job is to analyze the user's request, understand the requirements, and identify key aspects that need to be addressed."
        });
        log('Thinking phase completed successfully');
      } catch (error) {
        log(`Error in thinking phase: ${error.message}`);
        log('Full error details:');
        console.error(error);
        throw error;
      }
      
      task.history.push({
        phase: 'thinking',
        output: thinkingResult,
        timestamp: Date.now()
      });
      
      // Step 2: Planning phase
      await this._updateTaskStatus(taskId, 'planning');
      log('Starting planning phase...');
      let planningResult;
      try {
        planningResult = await this.agents.planner.process({
          input: task.prompt,
          context: "You are the planning agent. Based on the thinking agent's analysis, create a step-by-step plan to accomplish the task.",
          previousSteps: [{ role: 'thinking', content: thinkingResult }]
        });
        log('Planning phase completed successfully');
      } catch (error) {
        log(`Error in planning phase: ${error.message}`);
        log('Full error details:');
        console.error(error);
        throw error;
      }
      
      task.history.push({
        phase: 'planning',
        output: planningResult,
        timestamp: Date.now()
      });
      
      // Step 3: Execution phase
      await this._updateTaskStatus(taskId, 'executing');
      log('Starting execution phase...');
      let executionResult;
      try {
        executionResult = await this.agents.executor.process({
          input: task.prompt,
          context: "You are the executor agent. Execute the plan created by the planning agent, using tools when necessary.",
          previousSteps: [
            { role: 'thinking', content: thinkingResult },
            { role: 'planning', content: planningResult }
          ]
        });
        log('Execution phase completed successfully');
      } catch (error) {
        log(`Error in execution phase: ${error.message}`);
        log('Full error details:');
        console.error(error);
        throw error;
      }
      
      task.history.push({
        phase: 'executing',
        output: executionResult,
        timestamp: Date.now()
      });
      
      // Step 4: Review phase
      await this._updateTaskStatus(taskId, 'reviewing');
      log('Starting review phase...');
      let reviewResult;
      try {
        reviewResult = await this.agents.reviewer.process({
          input: task.prompt,
          context: "You are the reviewer agent. Review the execution results, identify any issues, and suggest improvements.",
          previousSteps: [
            { role: 'thinking', content: thinkingResult },
            { role: 'planning', content: planningResult },
            { role: 'executing', content: executionResult }
          ]
        });
        log('Review phase completed successfully');
      } catch (error) {
        log(`Error in review phase: ${error.message}`);
        log('Full error details:');
        console.error(error);
        throw error;
      }
      
      task.history.push({
        phase: 'reviewing',
        output: reviewResult,
        timestamp: Date.now()
      });
      
      // Mark task as completed
      await this._updateTaskStatus(taskId, 'completed', {
        thinking: thinkingResult,
        planning: planningResult,
        executing: executionResult,
        reviewing: reviewResult
      });
      
      return {
        thinking: thinkingResult,
        planning: planningResult,
        executing: executionResult,
        reviewing: reviewResult
      };
    } catch (error) {
      console.error(`Error in agent workflow for task ${taskId}:`, error);
      await this._updateTaskStatus(taskId, 'failed', { error: error.message });
      throw error;
    }
  }
  
  // Update task status
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
    
    return task;
  }
}

// Create the agent system with our custom MCP client
const agentSystem = new CustomAgentSystem(mcpClient);

// Custom function to monitor task progress
async function monitorTask(taskId) {
  let lastStatus = '';
  let lastPhase = '';
  
  // Check status every 2 seconds
  const interval = setInterval(async () => {
    try {
      const status = await agentSystem.getTaskStatus(taskId);
      
      // Only log if status or phase has changed
      if (status.status !== lastStatus) {
        console.log(`\n📊 TASK STATUS: ${status.status.toUpperCase()}`);
        lastStatus = status.status;
      }
      
      // Check for new history entries
      if (status.history && status.history.length > 0) {
        const latestEntry = status.history[status.history.length - 1];
        
        if (latestEntry.phase !== lastPhase) {
          console.log(`\n${getPhaseEmoji(latestEntry.phase)} ${latestEntry.phase.toUpperCase()} PHASE:`);
          console.log('-'.repeat(50));
          console.log(latestEntry.output);
          console.log('-'.repeat(50));
          lastPhase = latestEntry.phase;
        }
      }
      
      // If task is completed or failed, stop monitoring
      if (status.status === 'completed' || status.status === 'failed') {
        clearInterval(interval);
        
        if (status.status === 'completed') {
          console.log('\n✅ TASK COMPLETED SUCCESSFULLY!');
        } else {
          console.error('\n❌ TASK FAILED:', status.result?.error || 'Unknown error');
        }
      }
    } catch (error) {
      console.error('Error monitoring task:', error);
      clearInterval(interval);
    }
  }, 2000);
  
  return interval;
}

// Helper function to get emoji for each phase
function getPhaseEmoji(phase) {
  switch (phase) {
    case 'thinking': return '🧠';
    case 'planning': return '📝';
    case 'executing': return '🔧';
    case 'reviewing': return '🔍';
    default: return '🔄';
  }
}

// First ensure the Playwright MCP server is running
log('Initializing automation...');
ensurePlaywrightMCPServerRunning()
  .then(() => {
    log('Playwright MCP server is running in vision mode');
    
    // Execute the task
    log('\n🚀 EXECUTING TASK:');
    log(taskInput);
    log('\nThis may take a few minutes. Please wait...\n');
    
    // Start the task and get the task ID
    const taskId = agentSystem.startTask(taskInput);
    log(`Task ID: ${taskId}`);
    
    // Wait a moment to ensure the task is registered
    return new Promise(resolve => {
      setTimeout(() => {
        // Monitor the task progress
        monitorTask(taskId);
        resolve(taskId);
      }, 1000);
    });
  })
  .catch(error => {
    log(`❌ ERROR: ${error.message}`);
    console.error('Full error details:', error);
  })
  .then((taskId) => {
    // After monitoring is complete, get the final task status
    return agentSystem.getTaskStatus(taskId).then(status => {
      if (status.status === 'completed') {
        console.log('\n✅ FINAL RESULT:');
        console.log('-'.repeat(50));
        console.log(status.result);
        console.log('-'.repeat(50));
      }
      return mcpClient.stop();
    });
  })
  .then(() => {
    console.log('Playwright MCP client stopped');
    // Give some time for any pending operations to complete
    setTimeout(() => process.exit(0), 1000);
  })
  .catch((error) => {
    console.error('Error:', error);
    mcpClient.stop().finally(() => {
      setTimeout(() => process.exit(1), 1000);
    });
  });
