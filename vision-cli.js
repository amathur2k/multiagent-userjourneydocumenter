const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);
const url = args[0] || 'https://www.bluestone.com/jewellery/pendants.html';
const task = args[1] || 'find a product and attempt to buy it';

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  generationConfig: {
    temperature: 0.4,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 2048,
  }
});

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

// Simple function to log with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Function to take a screenshot and convert it to base64
async function takeScreenshot(page, filename) {
  const screenshotPath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: screenshotPath });
  log(`Screenshot saved to ${filename}`);
  const screenshotBuffer = fs.readFileSync(screenshotPath);
  return screenshotBuffer.toString('base64');
}

// Function to ask Gemini to analyze a screenshot
async function analyzeScreenshot(screenshotBase64, prompt) {
  try {
    log(`Asking Gemini to analyze screenshot with prompt: ${prompt}`);
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: screenshotBase64
        }
      }
    ]);
    
    const response = result.response;
    const text = response.text();
    log(`Gemini response: ${text}`);
    return text;
  } catch (error) {
    log(`Error analyzing screenshot: ${error.message}`);
    throw error;
  }
}

// Function to extract coordinates from Gemini's response
function extractCoordinates(text) {
  // Look for x,y coordinates in the text
  const coordPattern = /x\s*[=:]\s*(\d+)[^\d]*y\s*[=:]\s*(\d+)/i;
  const match = text.match(coordPattern);
  
  if (match) {
    return {
      x: parseInt(match[1]),
      y: parseInt(match[2])
    };
  }
  
  return null;
}

// Main function to run the vision-based automation
async function runVisionAutomation() {
  log('Starting vision-based automation');
  log(`URL: ${url}`);
  log(`Task: ${task}`);
  
  // Launch browser
  log('Launching browser');
  const browser = await chromium.launch({ 
    headless: false // Run in non-headless mode so we can see what's happening
  });
  
  // Create a new context
  const context = await browser.newContext();
  
  // Create a new page
  const page = await context.newPage();
  
  try {
    // Navigate to the page
    log(`Navigating to ${url}`);
    await page.goto(url);
    
    // Wait for the page to load
    log('Waiting for page to load');
    await page.waitForLoadState('networkidle');
    
    // Add an extra delay to ensure everything is loaded
    log('Adding extra delay for page rendering');
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the initial page
    log('Taking screenshot: initial-page.png');
    const initialScreenshotBase64 = await takeScreenshot(page, 'initial-page.png');
    
    // Ask Gemini to analyze the screenshot and find a product to click
    const initialPrompt = `Look at this screenshot of a product listing page. ${task}. Find a product that looks interesting. Describe exactly where the product is located on the screen and provide specific details about what it looks like. Also, estimate the x,y coordinates where I should click to select this product.`;
    
    const initialAnalysis = await analyzeScreenshot(initialScreenshotBase64, initialPrompt);
    
    // Extract coordinates from the analysis
    let productCoordinates = extractCoordinates(initialAnalysis);
    
    if (!productCoordinates) {
      log('Could not automatically extract coordinates from the analysis');
      log('Please examine the analysis and the screenshot, then click on a product manually');
      
      // Use fallback coordinates (center of the screen)
      const viewportSize = await page.viewportSize();
      productCoordinates = {
        x: Math.floor(viewportSize.width / 2),
        y: Math.floor(viewportSize.height / 3)
      };
    }
    
    log(`Clicking at coordinates: x=${productCoordinates.x}, y=${productCoordinates.y}`);
    await page.mouse.click(productCoordinates.x, productCoordinates.y);
    
    // Wait for the product page to load
    log('Waiting for product page to load');
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the product page
    log('Taking screenshot: product-page.png');
    const productScreenshotBase64 = await takeScreenshot(page, 'product-page.png');
    
    // Ask Gemini to analyze the screenshot and find the buy button
    const buyButtonPrompt = `Look at this screenshot of a jewelry product page. Find the 'Buy Now' or similar purchase button. Describe exactly where the button is located on the screen and provide specific details about what it looks like. Also, estimate the x,y coordinates where I should click to press this button.`;
    
    const buyButtonAnalysis = await analyzeScreenshot(productScreenshotBase64, buyButtonPrompt);
    
    // Extract coordinates from the analysis
    let buyButtonCoordinates = extractCoordinates(buyButtonAnalysis);
    
    if (!buyButtonCoordinates) {
      log('Could not automatically extract buy button coordinates from the analysis');
      log('Trying to find buy button by text content');
      
      // Try to find the buy button by text content
      const buyButtonSelector = 'button:has-text("Buy"), a:has-text("Buy")';
      const buyButton = await page.$(buyButtonSelector);
      
      if (buyButton) {
        const boundingBox = await buyButton.boundingBox();
        if (boundingBox) {
          buyButtonCoordinates = {
            x: Math.floor(boundingBox.x + boundingBox.width / 2),
            y: Math.floor(boundingBox.y + boundingBox.height / 2)
          };
        }
      }
      
      // If still not found, use fallback coordinates
      if (!buyButtonCoordinates) {
        const viewportSize = await page.viewportSize();
        buyButtonCoordinates = {
          x: Math.floor(viewportSize.width / 2),
          y: Math.floor(viewportSize.height * 0.6)
        };
      }
    }
    
    log(`Clicking buy button at coordinates: x=${buyButtonCoordinates.x}, y=${buyButtonCoordinates.y}`);
    await page.mouse.click(buyButtonCoordinates.x, buyButtonCoordinates.y);
    
    // Wait for the checkout page to load
    log('Waiting for checkout page to load');
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the checkout page
    log('Taking screenshot: checkout-page.png');
    await takeScreenshot(page, 'checkout-page.png');
    
    log('Successfully completed the automation flow');
    
  } catch (error) {
    log(`Error during automation: ${error.message}`);
    console.error(error);
  } finally {
    // Close the browser
    log('Closing browser');
    await browser.close();
  }
  
  log('Vision automation completed');
}

// Display help message if --help flag is provided
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Vision-based Automation CLI

Usage:
  node vision-cli.js [url] [task]

Arguments:
  url   URL to navigate to (default: https://www.bluestone.com/jewellery/pendants.html)
  task  Task description (default: find a product and attempt to buy it)

Examples:
  node vision-cli.js
  node vision-cli.js https://www.bluestone.com/jewellery/pendants.html "find a diamond pendant and buy it"
  node vision-cli.js https://www.amazon.com "search for headphones and add one to cart"
  `);
  process.exit(0);
}

// Run the vision automation
runVisionAutomation().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
