import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible .env locations
const envPaths = [
  path.resolve(__dirname, '.env'),           // server/.env
  path.resolve(__dirname, '../.env'),        // root .env
  path.resolve(process.cwd(), '.env'),       // cwd/.env
  path.resolve(process.cwd(), 'server/.env'), // cwd/server/.env
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`📝 Loading .env from: ${envPath}`);
    dotenv.config({ path: envPath });
    break;
  }
}
