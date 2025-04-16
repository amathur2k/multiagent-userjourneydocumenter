require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { AgentSystem } = require('./src/agentSystem');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize agent system
const agentSystem = new AgentSystem();

// SSE endpoint for agent responses
app.get('/api/agent-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Function to send SSE data
  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Register the response object with the agent system
  const clientId = Date.now().toString();
  agentSystem.registerClient(clientId, sendSSE);
  
  // Handle client disconnect
  req.on('close', () => {
    agentSystem.unregisterClient(clientId);
  });
});

// API endpoint to start a new agent task
app.post('/api/start-task', async (req, res) => {
  try {
    const { prompt, tools = [] } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    
    const taskId = await agentSystem.startTask(prompt, tools);
    res.json({ taskId });
  } catch (error) {
    console.error('Error starting task:', error);
    res.status(500).json({ error: 'Failed to start task' });
  }
});

// API endpoint to check task status
app.get('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const status = await agentSystem.getTaskStatus(taskId);
    res.json(status);
  } catch (error) {
    console.error('Error getting task status:', error);
    res.status(500).json({ error: 'Failed to get task status' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Multi-agent system server running on port ${port}`);
  console.log(`SSE endpoint available at http://localhost:${port}/api/agent-stream`);
  console.log(`API endpoint to start tasks at http://localhost:${port}/api/start-task`);
});
