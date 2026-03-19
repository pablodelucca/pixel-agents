import crypto from 'crypto';

// Get RSA keys from environment
const PRIVATE_KEY = process.env.RSA_PRIVATE_KEY?.replace(/\\n/g, '\n');
const PUBLIC_KEY = process.env.RSA_PUBLIC_KEY?.replace(/\\n/g, '\n');

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.warn('⚠️ RSA keys not found in environment. Password encryption/decryption will not work.');
}

/**
 * Decrypt password using RSA-OAEP
 * @param encryptedPassword - Base64 encoded encrypted password
 * @returns Decrypted password string
 */
export function decryptPassword(encryptedPassword: string): string {
  if (!PRIVATE_KEY) {
    throw new Error('RSA private key not configured');
  }

  try {
    const buffer = Buffer.from(encryptedPassword, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: PRIVATE_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(`Failed to decrypt password: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Encrypt password using RSA-OAEP (for frontend use, but keeping here for reference)
 * @param password - Plain text password
 * @returns Base64 encoded encrypted password
 */
export function encryptPassword(password: string): string {
  if (!PUBLIC_KEY) {
    throw new Error('RSA public key not configured');
  }

  try {
    const buffer = Buffer.from(password, 'utf8');
    const encrypted = crypto.publicEncrypt(
      {
        key: PUBLIC_KEY,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );
    return encrypted.toString('base64');
  } catch (error) {
    throw new Error(`Failed to encrypt password: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate RSA key pair for testing/initial setup
 * Run this once to generate keys
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  return { privateKey, publicKey };
}

// CLI utility to generate keys
if (process.argv[1].includes('crypto.ts') && process.argv[2] === 'generate-keys') {
  const { privateKey, publicKey } = generateKeyPair();
  console.log('=== RSA PRIVATE KEY ===');
  console.log(privateKey);
  console.log('\n=== RSA PUBLIC KEY ===');
  console.log(publicKey);
  console.log('\nAdd these to your .env file:');
  console.log('RSA_PRIVATE_KEY=<base64 encoded private key>');
  console.log('RSA_PUBLIC_KEY=<base64 encoded public key>');
}
