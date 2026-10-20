'use strict';
// Usage: node scripts/setup-auth.js
// Prints fresh random secrets to paste into Vercel. The login itself (email + password) lives in Supabase Auth.
const crypto = require('crypto');

console.log('Add these in Vercel > Project > Settings > Environment Variables (then redeploy):\n');
console.log('SESSION_SECRET=' + crypto.randomBytes(48).toString('base64url'));
console.log('CRON_SECRET=' + crypto.randomBytes(32).toString('base64url'));
console.log('\nAlso set (see README): OWNER_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
console.log('Generating a new SESSION_SECRET later signs every device out.');
