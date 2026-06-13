// Discover eHunt's actual request headers by intercepting at CDP network level
// This captures httpOnly cookies and custom headers that DOM-level interception misses
// Run: node lib/discover-ehunt-api.js
// Requires: Chrome running with CDP on port 9222, logged into ehunt.ai

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));

async function discover() {
  const port = CONFIG.cdpPort || 9222;
  console.log(`Connecting to Chrome on port ${port}...`);

  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Get CDP session for low-level network interception
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Network.enable');

  const capturedRequests = [];

  // Listen for requests at the CDP level - captures ALL headers including httpOnly cookies
  cdpSession.on('Network.requestWillBeSent', (params) => {
    const url = params.request.url;
    if (url.includes('keyword') || url.includes('/api/')) {
      console.log(`\n[REQUEST] ${params.request.method} ${url}`);
      console.log('  Headers:', JSON.stringify(params.request.headers, null, 2));
      capturedRequests.push({
        url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData,
      });
    }
  });

  cdpSession.on('Network.responseReceived', async (params) => {
    const url = params.response.url;
    if (url.includes('keyword') || url.includes('/api/')) {
      console.log(`\n[RESPONSE] ${params.response.status} ${url}`);
      console.log('  Response Headers:', JSON.stringify(params.response.headers, null, 2));

      // Try to get response body
      try {
        const { body } = await cdpSession.send('Network.getResponseBody', {
          requestId: params.requestId,
        });
        const preview = body.length > 500 ? body.substring(0, 500) + '...' : body;
        console.log('  Body:', preview);

        // Update captured request with response
        const req = capturedRequests.find(r => r.url === url);
        if (req) {
          req.responseStatus = params.response.status;
          req.responseHeaders = params.response.headers;
          req.responseBody = preview;
        }
      } catch (e) {
        console.log('  (could not get body)');
      }
    }
  });

  // Navigate to eHunt keyword tool
  console.log('\nNavigating to eHunt keyword tool...');
  await page.goto('https://ehunt.ai/etsy-keyword-tool?keyword=funny+cat+shirt', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  console.log('Waiting for page + iframe to load...');
  await page.waitForTimeout(8000);

  // Now intercept iframe requests too
  const frames = page.frames();
  console.log(`\nFound ${frames.length} frames`);

  for (const frame of frames) {
    const frameUrl = frame.url();
    console.log(`  Frame: ${frameUrl.substring(0, 120)}`);

    // If this is the ehunt iframe, set up CDP interception on it too
    if (frameUrl.includes('ehunt') && frameUrl.includes('iframe')) {
      try {
        const framePage = frame.page();
        // The iframe requests should already be captured by the parent page's CDP session
        console.log('  -> eHunt iframe found, requests should be captured');
      } catch (e) {
        console.log('  -> Could not access iframe:', e.message);
      }
    }
  }

  // Also extract ALL cookies for ehunt.ai domain via CDP
  console.log('\n--- Extracting ALL cookies (including httpOnly) ---');
  const { cookies } = await cdpSession.send('Network.getCookies', {
    urls: ['https://ehunt.ai'],
  });
  console.log(`Found ${cookies.length} cookies:`);
  for (const c of cookies) {
    console.log(`  ${c.name}=${c.value.substring(0, 40)}... (httpOnly: ${c.httpOnly}, secure: ${c.secure})`);
  }

  // Wait more for any async API calls from the iframe
  console.log('\nWaiting 10 more seconds for iframe API calls...');
  await page.waitForTimeout(10000);

  // Try triggering a search manually in the iframe
  for (const frame of page.frames()) {
    if (frame.url().includes('ehunt') && frame.url().includes('iframe')) {
      console.log('\nTrying to trigger search in iframe...');
      try {
        // Try clicking search or entering keyword
        await frame.evaluate(() => {
          // Find search input and trigger
          const inputs = document.querySelectorAll('input');
          for (const inp of inputs) {
            if (inp.placeholder && inp.placeholder.toLowerCase().includes('keyword')) {
              inp.value = 'test keyword';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          // Find search button
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('Search') || btn.textContent.includes('search')) {
              btn.click();
            }
          }
        });
        console.log('Search triggered, waiting for API call...');
        await page.waitForTimeout(8000);
      } catch (e) {
        console.log('Could not trigger search:', e.message);
      }
    }
  }

  // Save all captured data
  const resultFile = path.join(__dirname, '..', 'ehunt-api-discovery.json');
  const result = {
    capturedRequests,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      httpOnly: c.httpOnly,
      secure: c.secure,
      domain: c.domain,
      path: c.path,
    })),
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(`\n${capturedRequests.length} API requests captured. Saved to ehunt-api-discovery.json`);

  await page.close();
}

discover().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
