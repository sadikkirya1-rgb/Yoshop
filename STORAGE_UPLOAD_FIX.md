# Firebase Storage Upload Fix - Complete Guide

## ✅ Step 1: Storage Rules (DEPLOYED)
**Status**: ✅ Storage security rules have been deployed successfully

The rules now allow authenticated users to upload images to the shops folder:
```
match /shops/{shopId}/{allPaths=**} {
  allow read: if isAuthenticated();
  allow write: if isAuthenticated() && isValidImageUpload();
}
```

## Step 2: CORS Configuration (NEEDS MANUAL APPLICATION)

Since `gsutil` and `gcloud` are not available in this environment, please apply CORS manually:

### Method 1: Firebase Console (Recommended - 2 minutes)
1. Go to: https://console.firebase.google.com/project/yoshop-b502f/storage
2. Click on your bucket: **yoshop-b502f.appspot.com**
3. Click the **CORS** tab (top navigation)
4. Delete any existing CORS configuration
5. Click **Add CORS Configuration**
6. Paste this JSON:

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "maxAgeSeconds": 3600
  },
  {
    "origin": ["localhost", "127.0.0.1", "https://yoshop-b502f.web.app"],
    "method": ["GET", "HEAD", "POST", "PUT", "DELETE"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Authorization", "x-goog-meta-*"]
  }
]
```

7. Click **Create** button
8. Wait for deployment (usually 1-2 minutes)

### Method 2: Using gcloud (if available on your local machine)
```bash
gsutil cors set cors.json gs://yoshop-b502f.appspot.com
```

## Step 3: Test the Fix

After applying CORS in the Firebase Console:

1. **Refresh your browser** (Ctrl+F5 or Cmd+Shift+R for hard refresh)
2. **Clear browser cache** for the app domain
3. **Try uploading a product image again**
4. Check browser console for success message

## Troubleshooting

If you still get 403 Forbidden errors:

1. **Clear IndexedDB**: Open DevTools > Application > IndexedDB > Clear All
2. **Check authentication**: Console should show "Logged in, syncing cloud data..."
3. **Verify CORS applied**: 
   - Open DevTools > Network tab
   - Try uploading
   - Look for OPTIONS preflight request (should be 200 OK, not 403)

## What You Need to Do Now

👉 **IMPORTANT**: Go to Firebase Console and apply CORS configuration manually using Method 1 above.

The storage rules are ready. Once you apply CORS through the console, image uploads should work!
