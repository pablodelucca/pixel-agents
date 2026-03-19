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

// Verify critical env vars are loaded
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ Supabase credentials not found. Database operations will not work.');
}

if (!process.env.RSA_PRIVATE_KEY || !process.env.RSA_PUBLIC_KEY) {
  console.warn('⚠️ RSA keys not found in environment. Password encryption/decryption will not work.');
}
