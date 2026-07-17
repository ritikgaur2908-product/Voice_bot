import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import { exec } from 'child_process';

const credentialsPath = path.resolve('./credentials/google-sa.json');
const tokensPath = path.resolve('./credentials/tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.compose'
];

async function authenticate() {
  if (!fs.existsSync(credentialsPath)) {
    console.error(`Credentials file not found at ${credentialsPath}`);
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const clientType = credentials.installed ? 'installed' : 'web';
  const { client_id, client_secret, redirect_uris } = credentials[clientType];
  const redirectUri = redirect_uris[0] || 'http://localhost';

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
  );

  // If tokens already exist, check if they are valid
  if (fs.existsSync(tokensPath)) {
    console.error("Tokens already exist. Validating...");
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    oauth2Client.setCredentials(tokens);
    try {
      await oauth2Client.getAccessToken();
      console.error("Existing tokens are valid!");
      process.exit(0);
    } catch (err) {
      console.error("Existing tokens are invalid or expired. Re-authenticating...");
    }
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // crucial for refresh token
    scope: SCOPES,
    prompt: 'consent' // force consent to get refresh token
  });

  console.error('\n======================================================');
  console.error('Google Authentication Required');
  console.error('======================================================');
  console.error('Opening browser to authenticate. If it does not open, please copy/paste this URL into your browser:\n');
  console.error(authUrl);
  console.error('======================================================\n');

  // Start local server to catch the authorization code
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url && req.url.startsWith('/?code=')) {
        const urlParams = new URL(req.url, `http://localhost`);
        const code = urlParams.searchParams.get('code');
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Successful!</h1><p>You can close this window now. The tokens have been saved.</p>');
        
        server.close();

        if (code) {
          console.error("Authorization code received. Exchanging for tokens...");
          const { tokens } = await oauth2Client.getToken(code);
          fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');
          console.error(`Tokens saved successfully to ${tokensPath}!`);
          process.exit(0);
        } else {
          console.error("No authorization code found in URL.");
          process.exit(1);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      console.error("Error handling authentication callback:", error);
      res.writeHead(500);
      res.end("Internal Server Error");
      process.exit(1);
    }
  });

  const urlObj = new URL(redirectUri);
  const port = urlObj.port ? parseInt(urlObj.port) : 80;

  server.listen(port, () => {
    console.error(`Waiting for callback on port ${port}...`);
    // Attempt to open the browser automatically
    const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${startCmd} "${authUrl.replace(/&/g, '^&')}"`);
  });
}

authenticate().catch(err => {
  console.error("Authentication failed:", err);
  process.exit(1);
});
