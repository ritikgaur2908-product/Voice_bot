import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

const credentialsPath = path.resolve('./credentials/google-sa.json');
const tokensPath = path.resolve('./credentials/tokens.json');

async function exchange() {
  const code = process.argv[2];
  if (!code) {
    console.error("Please provide the authorization code as an argument.");
    process.exit(1);
  }

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

  console.error("Exchanging code for tokens...");
  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');
  console.error(`Tokens saved successfully to ${tokensPath}!`);
}

exchange().catch(err => {
  console.error("Failed to exchange code:", err);
  process.exit(1);
});
