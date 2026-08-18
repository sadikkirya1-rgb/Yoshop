#!/usr/bin/env node

/**
 * Apply CORS configuration to Firebase Storage bucket
 * Requires: npm install @google-cloud/storage
 * Usage: node apply-cors.js
 */

const fs = require('fs');
const path = require('path');

async function applyCors() {
  try {
    // Try dynamic import for ES modules
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage({
      projectId: 'yoshop-b502f'
    });

    const bucket = storage.bucket('yoshop-b502f.appspot.com');
    const corsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'cors.json'), 'utf8'));

    console.log('Applying CORS configuration...');
    console.log('CORS Config:', JSON.stringify(corsConfig, null, 2));

    await bucket.setCorsConfiguration(corsConfig);
    console.log('✅ CORS configuration applied successfully!');
  } catch (error) {
    console.error('❌ Error applying CORS:', error.message);
    console.log('\n📋 Manual Alternative:');
    console.log('1. Go to Firebase Console: https://console.firebase.google.com');
    console.log('2. Select project "yoshop-b502f"');
    console.log('3. Go to Storage > Your Bucket');
    console.log('4. Click "CORS" tab');
    console.log('5. Paste the contents of cors.json');
    process.exit(1);
  }
}

applyCors();
