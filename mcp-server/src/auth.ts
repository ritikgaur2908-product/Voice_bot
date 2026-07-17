import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpRoot = path.resolve(__dirname, '..');

const credentialsPath = path.resolve(mcpRoot, process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/google-sa.json');
const tokensPath = path.resolve(mcpRoot, './credentials/tokens.json');

let cachedAuth: any = null;
let isMock = false;

export function getGoogleAuthClient() {
  if (cachedAuth) return cachedAuth;
  if (isMock) return null;

  if (!fs.existsSync(credentialsPath)) {
    console.warn(`[Google Auth] Credentials file not found at ${credentialsPath}. Running in MOCK mode.`);
    isMock = true;
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    // Check if it's an OAuth2 client credential or a Service Account
    if (creds.installed || creds.web) {
      // OAuth2 Flow
      if (!fs.existsSync(tokensPath)) {
        console.warn(`[Google Auth] OAuth credentials found, but tokens.json is missing. Please run authentication first. Running in MOCK mode.`);
        isMock = true;
        return null;
      }

      const clientType = creds.installed ? 'installed' : 'web';
      const { client_id, client_secret, redirect_uris } = creds[clientType];
      const redirectUri = redirect_uris[0] || 'http://localhost';

      const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      oauth2Client.setCredentials(tokens);

      // Save token updates automatically
      oauth2Client.on('tokens', (newTokens) => {
        console.error('[Google Auth] Refreshing OAuth tokens...');
        try {
          const currentTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
          const updatedTokens = { ...currentTokens, ...newTokens };
          fs.writeFileSync(tokensPath, JSON.stringify(updatedTokens, null, 2), 'utf8');
        } catch (e) {
          console.error('[Google Auth] Failed to save updated tokens:', e);
        }
      });

      cachedAuth = oauth2Client;
      return oauth2Client;
    } else if (creds.client_email && creds.private_key) {
      // Service Account Flow
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/gmail.compose'
        ],
      });
      cachedAuth = auth;
      return auth;
    } else {
      console.warn(`[Google Auth] Unknown credentials format in ${credentialsPath}. Running in MOCK mode.`);
      isMock = true;
      return null;
    }
  } catch (error) {
    console.error('[Google Auth] Failed to initialize live client:', error);
    isMock = true;
    return null;
  }
}

export function isMockMode() {
  getGoogleAuthClient();
  return isMock;
}
