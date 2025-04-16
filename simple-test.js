const { chromium } = require('playwright');
require('dotenv').config();

// The URL to navigate to
const url = 'https://www.bluestone.com/jewellery/pendants.html';

// Simple function to log with timestamps
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function runTest() {
  log('Starting browser automation test');
  
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
    
    // Take a screenshot
    log('Taking screenshot of the pendants page');
    await page.screenshot({ path: 'pendants-page.png' });
    
    // Get the HTML content for debugging
    const htmlContent = await page.content();
    require('fs').writeFileSync('page-content.html', htmlContent);
    log('Saved HTML content to page-content.html');
    
    // Find a product to click on - using a very general approach
    log('Looking for any clickable product elements');
    
    // Log all available links on the page
    const allLinks = await page.$$('a');
    log(`Found ${allLinks.length} total links on the page`);
    
    // Try to find product links with a very general approach
    log('Searching for product links by text content');
    const productLinks = await page.$$('a[href*="jewellery"], a[href*="pendant"], a[href*="product"]');
    log(`Found ${productLinks.length} potential product links`);
    
    // Take a screenshot with highlighted elements if possible
    log('Taking debug screenshot');
    if (productLinks.length > 0) {
      await productLinks[0].highlight();
    }
    await page.screenshot({ path: 'debug-products.png' });
    
    if (productLinks.length > 0) {
      log(`Found ${productLinks.length} products, clicking on the first one`);
      
      // Click on the first product
      await productLinks[0].click();
      
      // Wait for the product page to load
      log('Waiting for product page to load');
      await page.waitForLoadState('networkidle');
      
      // Take a screenshot of the product page
      log('Taking screenshot of the product page');
      await page.screenshot({ path: 'product-page.png' });
      
      // Try to find the buy now button
      log('Looking for the buy now button');
      const buyButton = await page.$('button.buynow-btn');
      
      if (buyButton) {
        log('Found buy now button, clicking it');
        await buyButton.click();
        
        // Wait for the checkout page to load
        log('Waiting for checkout page to load');
        await page.waitForLoadState('networkidle');
        
        // Take a screenshot of the checkout page
        log('Taking screenshot of the checkout page');
        await page.screenshot({ path: 'checkout-page.png' });
        
        log('Successfully navigated to the checkout page');
      } else {
        log('Buy now button not found');
      }
    } else {
      log('No products found on the page');
    }
  } catch (error) {
    log(`Error during test: ${error.message}`);
    console.error(error);
  } finally {
    // Close the browser
    log('Closing browser');
    await browser.close();
    log('Test completed');
  }
}

// Run the test
runTest().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
