/**
 * Pinterest OAuth 2.0 Authentication Flow
 *
 * Usage: node pinterest_auth.js
 *
 * Prerequisites:
 * 1. Pinterest Business account
 * 2. Developer app at https://developers.pinterest.com/apps/
 * 3. .env file with PINTEREST_APP_ID and PINTEREST_APP_SECRET
 * 4. Add redirect URI in your Pinterest app settings: http://localhost:3000/callback
 */

require('dotenv/config');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const { exec } = require('child_process');

const APP_ID = process.env.PINTEREST_APP_ID;
const APP_SECRET = process.env.PINTEREST_APP_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const TOKEN_FILE = 'pinterest_token.json';
const SCOPES = 'boards:read,boards:write,pins:read,pins:write';

if (!APP_ID || !APP_SECRET) {
  console.error('Missing PINTEREST_APP_ID or PINTEREST_APP_SECRET in .env file');
  process.exit(1);
}

async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token,
    scope: SCOPES,
  });

  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

function saveToken(tokenData) {
  tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
  tokenData.obtained_at = new Date().toISOString();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  console.log('Token saved to ' + TOKEN_FILE);
}

(async () => {
  // Check if we already have a valid token
  if (fs.existsSync(TOKEN_FILE)) {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (tokenData.expires_at && Date.now() < tokenData.expires_at) {
      console.log('Existing token is still valid (expires: ' + new Date(tokenData.expires_at).toLocaleString() + ')');
      console.log('To force re-auth, delete pinterest_token.json and run again.');
      process.exit(0);
    }
    if (tokenData.refresh_token) {
      console.log('Token expired, attempting refresh...');
      try {
        const refreshed = await refreshToken(tokenData.refresh_token);
        saveToken(refreshed);
        console.log('Token refreshed successfully!');
        process.exit(0);
      } catch (e) {
        console.log('Refresh failed, starting new OAuth flow...', e.message);
      }
    }
  }

  // Start OAuth flow
  const authUrl = `https://www.pinterest.com/oauth/?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${SCOPES}&state=etsy_pinner`;

  console.log('\nStarting Pinterest OAuth flow...');
  console.log('Opening browser to authorize...\n');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3000');

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Error: No authorization code received</h1>');
        return;
      }

      try {
        console.log('Received authorization code, exchanging for token...');
        const tokenData = await exchangeCode(code);
        saveToken(tokenData);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h1 style="color:green">Pinterest Authorization Successful!</h1>
            <p>Token saved. You can close this window.</p>
            <p>Token expires: ${new Date(tokenData.expires_at).toLocaleString()}</p>
          </body></html>
        `);

        console.log('\nAuthorization complete! Token saved to ' + TOKEN_FILE);
        console.log('Next step: run  node pinterest_board.js');
        setTimeout(() => process.exit(0), 1000);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h1>Error</h1><pre>${err.message}</pre>`);
        console.error('Error:', err.message);
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(3000, () => {
    console.log('Callback server listening on http://localhost:3000');
    console.log('\nIf browser does not open, visit this URL:\n');
    console.log(authUrl + '\n');

    // Open browser (Windows)
    exec(`start "" "${authUrl}"`);
  });
})();
