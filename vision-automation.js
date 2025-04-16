const { chromium } = require('playwright');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
require('dotenv').config();

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

// The URL to navigate to
const url = 'https://www.bluestone.com/jewellery/pendants.html';

// Simple function to log with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Function to take a screenshot and convert it to base64
async function takeScreenshot(page, path) {
  log(`Taking screenshot: ${path}`);
  await page.screenshot({ path });
  const buffer = fs.readFileSync(path);
  return buffer.toString('base64');
}

// Function to ask Gemini to analyze a screenshot
async function analyzeScreenshot(screenshotBase64, prompt) {
  log(`Asking Gemini to analyze screenshot with prompt: ${prompt}`);
  
  const image = {
    inlineData: {
      data: screenshotBase64,
      mimeType: 'image/png'
    }
  };
  
  const result = await model.generateContent([prompt, image]);
  const response = await result.response;
  const text = response.text();
  log(`Gemini response: ${text}`);
  return text;
}

async function runVisionAutomation() {
  log('Starting vision-based browser automation');
  
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
    await page.waitForTimeout(3000); // Extra delay for rendering
    
    // Take a screenshot of the pendants page
    const screenshotBase64 = await takeScreenshot(page, 'pendants-page.png');
    
    // Ask Gemini to find a product to click on
    const findProductPrompt = "Look at this screenshot of a jewelry website. Find a pendant product that I can click on. Describe exactly where the product is located on the screen (top, bottom, left, right, etc.) and provide specific details about what the product looks like so I can identify it. Also, estimate the x,y coordinates where I should click to select this product.";
    
    const productAnalysis = await analyzeScreenshot(screenshotBase64, findProductPrompt);
    
    // Extract coordinates from the analysis (this is a simple approach, you might need to improve it)
    let x, y;
    const coordinatesMatch = productAnalysis.match(/coordinates.*?(\d+).*?(\d+)/i);
    if (coordinatesMatch && coordinatesMatch.length >= 3) {
      x = parseInt(coordinatesMatch[1]);
      y = parseInt(coordinatesMatch[2]);
      log(`Extracted coordinates: x=${x}, y=${y}`);
    } else {
      // If no coordinates found, ask the user to provide them based on the analysis
      log('Could not automatically extract coordinates from the analysis');
      log('Please examine the analysis and the screenshot, then click on a product manually');
      
      // For this example, we'll just click in the middle of the page
      const viewportSize = await page.viewportSize();
      x = viewportSize.width / 2;
      y = viewportSize.height / 2;
      log(`Using fallback coordinates: x=${x}, y=${y}`);
    }
    
    // Click on the product
    log(`Clicking at coordinates: x=${x}, y=${y}`);
    await page.mouse.click(x, y);
    
    // Wait for navigation and page load
    log('Waiting for product page to load');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Extra delay for rendering
    
    // Take a screenshot of the product page
    const productPageScreenshot = await takeScreenshot(page, 'product-page.png');
    
    // Ask Gemini to find the buy button
    const findBuyButtonPrompt = "Look at this screenshot of a jewelry product page. Find the 'Buy Now' or similar purchase button. Describe exactly where the button is located on the screen and provide specific details about what it looks like. Also, estimate the x,y coordinates where I should click to press this button.";
    
    const buyButtonAnalysis = await analyzeScreenshot(productPageScreenshot, findBuyButtonPrompt);
    
    // Extract coordinates for the buy button
    let buyX, buyY;
    const buyCoordinatesMatch = buyButtonAnalysis.match(/coordinates.*?(\d+).*?(\d+)/i);
    if (buyCoordinatesMatch && buyCoordinatesMatch.length >= 3) {
      buyX = parseInt(buyCoordinatesMatch[1]);
      buyY = parseInt(buyCoordinatesMatch[2]);
      log(`Extracted buy button coordinates: x=${buyX}, y=${buyY}`);
    } else {
      // If no coordinates found, ask the user to provide them based on the analysis
      log('Could not automatically extract buy button coordinates from the analysis');
      
      // For this example, we'll look for common buy button text
      log('Trying to find buy button by text content');
      const buyButton = await page.$('button:has-text("Buy Now"), button:has-text("Add to Cart"), a:has-text("Buy Now")');
      
      if (buyButton) {
        const boundingBox = await buyButton.boundingBox();
        buyX = boundingBox.x + boundingBox.width / 2;
        buyY = boundingBox.y + boundingBox.height / 2;
        log(`Found buy button at: x=${buyX}, y=${buyY}`);
      } else {
        // Fallback to clicking in the lower part of the page where buy buttons often are
        const viewportSize = await page.viewportSize();
        buyX = viewportSize.width / 2;
        buyY = viewportSize.height * 0.8; // 80% down the page
        log(`Using fallback buy button coordinates: x=${buyX}, y=${buyY}`);
      }
    }
    
    // Click on the buy button
    log(`Clicking buy button at coordinates: x=${buyX}, y=${buyY}`);
    await page.mouse.click(buyX, buyY);
    
    // Wait for checkout page to load
    log('Waiting for checkout page to load');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Extra delay for rendering
    
    // Take a screenshot of the checkout page
    await takeScreenshot(page, 'checkout-page.png');
    
    log('Successfully completed the automation flow');
    
  } catch (error) {
    log(`Error during vision automation: ${error.message}`);
    console.error(error);
  } finally {
    // Close the browser
    log('Closing browser');
    await browser.close();
    log('Vision automation completed');
  }
}

// Run the vision automation
runVisionAutomation().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
