# Multi-Agent System with Gemini and Playwright MCP

A Node.js application that implements a multi-agent system capable of thinking, planning, reviewing, and repeating tasks using Google's Gemini LLM. The system uses Microsoft's Playwright MCP (Message Control Protocol) server for browser automation and tool execution, with SSE (Server-Sent Events) endpoints for real-time updates. It also includes vision-based automation capabilities using Gemini's vision models.

## Features

- **Multi-Agent Architecture**: Separate agents for thinking, planning, executing, and reviewing tasks
- **Playwright MCP Integration**: Uses Microsoft's Playwright MCP server for browser automation and tool execution
- **Real-time Updates**: Server-Sent Events (SSE) for real-time updates to clients
- **Web Interface**: Simple web UI to interact with the multi-agent system
- **Gemini Integration**: Powered by Google's advanced LLM
- **Vision-Based Automation**: Uses Gemini's vision capabilities to analyze screenshots and guide browser automation
- **CLI Mode**: Command-line interface for running tasks with console output

## Prerequisites

- Node.js (v14 or higher)
- Google Gemini API key
- Playwright (automatically installed as a dependency)

## Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the root directory with your Gemini API key and Playwright MCP configuration:
   ```
   GEMINI_API_KEY=your_api_key_here
   PORT=3000
   
   # Playwright MCP Configuration
   MCP_PORT=3001
   MCP_BROWSER=chrome
   MCP_HEADLESS=false
   MCP_VISION=false
   ```

## Usage

Start the server with a single command:

```
node start.js
```

Then open your browser to http://localhost:3000 to access the web interface.

### API Endpoints

- `GET /api/agent-stream`: SSE endpoint for real-time updates
- `POST /api/start-task`: Start a new task with the multi-agent system
- `GET /api/task/:taskId`: Get the status of a specific task

### Available Tools

The system integrates with Microsoft's Playwright MCP server, providing a wide range of browser automation tools:

#### Browser Navigation
- `browser_navigate`: Navigate to a URL
- `browser_navigate_back`: Go back to the previous page
- `browser_navigate_forward`: Go forward to the next page

#### Page Interaction
- `browser_click`: Click on an element
- `browser_hover`: Hover over an element
- `browser_type`: Type text into an element
- `browser_select_option`: Select options in a dropdown

#### Page Capture
- `browser_snapshot`: Capture accessibility snapshot of the page
- `browser_take_screenshot`: Take a screenshot of the page

#### Tab Management
- `browser_tab_list`: List browser tabs
- `browser_tab_new`: Open a new tab
- `browser_tab_select`: Select a tab by index
- `browser_tab_close`: Close a tab

#### Additional Tools
- `browser_press_key`: Press a key on the keyboard
- `browser_console_messages`: Get console messages
- `browser_file_upload`: Upload files
- `browser_pdf_save`: Save page as PDF
- `browser_wait`: Wait for a specified time

The system also includes standard utility tools:
- `web_search`: Search the web for information
- `read_file`: Read the contents of a file
- `write_file`: Write content to a file
- `run_command`: Run a shell command

## Architecture

### Components

1. **Agent System**: Coordinates the multi-agent workflow
2. **Agents**: Specialized LLM instances with specific roles
   - Thinker: Analyzes and understands the task
   - Planner: Creates a step-by-step plan
   - Executor: Carries out the plan using tools
   - Reviewer: Evaluates the results and suggests improvements
3. **Playwright MCP Client**: Connects to the Playwright MCP server for browser automation
4. **Tool Registry**: Manages available tools and permissions

### Workflow

1. User submits a task
2. Thinking agent analyzes the task
3. Planning agent creates a plan
4. Executor agent implements the plan using tools (including Playwright MCP tools)
5. Reviewer agent evaluates the results
6. Final result is returned to the user

## Extending the System

### Adding New Tools

To add a new tool, update the `toolRegistry.js` file with your tool definition.

### Customizing Agent Behavior

Modify the prompt templates in the `agent.js` file to customize how each agent processes tasks.

### Configuring Playwright MCP

You can configure the Playwright MCP server by modifying the environment variables in the `.env` file:

- `MCP_PORT`: Port for the Playwright MCP server (default: 3001)
- `MCP_BROWSER`: Browser to use (chrome, firefox, webkit, msedge)
- `MCP_HEADLESS`: Whether to run the browser in headless mode (true/false)
- `MCP_VISION`: Whether to use vision mode instead of snapshot mode (true/false)

## License

ISC
