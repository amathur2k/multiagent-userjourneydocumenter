const { AgentSystem } = require('./src/agentSystem');
const { ToolRegistry } = require('./src/toolRegistry');
const { MCPClient } = require('./src/mcpClient');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const taskInput = args.join(' ') || 'Navigate to the page at https://www.bluestone.com/jewellery/pendants.html and find a product details page and click to it. After landing on the product page attempt to buy it. Always use screenshots and visual inspection to find the best actions.';

// Configure the MCP client
const mcpClient = new MCPClient({
  port: process.env.MCP_PORT || 8080, // Use port 8080 to avoid conflicts
  browser: process.env.MCP_BROWSER || 'chrome',
  headless: process.env.MCP_HEADLESS === 'true',
  vision: process.env.MCP_VISION === 'true',
  timeout: 60000 // 60 seconds timeout
});

// Create the tool registry with the MCP client
// This will automatically register default tools via the constructor
const toolRegistry = new ToolRegistry(mcpClient);

// Note: The ToolRegistry constructor already calls _registerDefaultTools()
// which registers web_search, read_file, write_file, and run_command tools

// Create the agent system
const agentSystem = new AgentSystem();

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

// Start the MCP client
console.log('Starting Playwright MCP client...');
mcpClient.start()
  .then(() => {
    console.log('Playwright MCP client started successfully');
    
    // Execute the task
    console.log('\n🚀 EXECUTING TASK:');
    console.log(taskInput);
    console.log('\nThis may take a few minutes. Please wait...\n');
    
    // Start the task and get the task ID
    const taskId = agentSystem.startTask(taskInput);
    console.log(`Task ID: ${taskId}`);
    
    // Wait a moment to ensure the task is registered
    return new Promise(resolve => {
      setTimeout(() => {
        // Monitor the task progress
        monitorTask(taskId);
        resolve(taskId);
      }, 1000);
    });
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
