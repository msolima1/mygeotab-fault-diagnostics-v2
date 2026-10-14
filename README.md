# MyGeotab Fault Diagnostics v2

AI-powered fault code analysis for MyGeotab fleet management. This Add-In fetches vehicle fault codes from the MyGeotab API and uses Claude AI (via Geotab GenAI Gateway) to provide diagnostic recommendations.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  MyGeotab Portal                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Fault Diagnostics Add-In               │    │
│  │  - Uses api.call() for Devices, FaultData       │    │
│  │  - Calls Cloud Function for AI analysis         │    │
│  └───────────────────────────┬─────────────────────┘    │
└──────────────────────────────┼──────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │   Google Cloud Function        │
              │   /analyze endpoint            │
              │   Proxies to GenAI Gateway     │
              └────────────────┬───────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │   GenAI Gateway (Geotab)       │
              │   Claude claude-haiku-4.5               │
              └────────────────────────────────┘
```

## Project Structure

```
mygeotab-fault-diagnostics-v2/
├── functions/                 # Google Cloud Function
│   ├── index.js              # Serverless AI proxy
│   └── package.json          # Dependencies
├── addin/                     # MyGeotab Add-In files
│   ├── index.html            # Main HTML
│   ├── main.js               # JavaScript logic
│   ├── styles.css            # Styling
│   ├── configuration.json    # Add-In config
│   └── icon.svg              # Navigation icon
└── README.md                  # This file
```

## Setup Instructions

### Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Geotab GenAI Gateway JWT token

### Step 1: Deploy Cloud Function

1. Set your GenAI token as an environment variable:
   ```bash
   export GENAI_TOKEN="your-genai-jwt-token"
   ```

2. Deploy the Cloud Function:
   ```bash
   cd functions
   gcloud functions deploy analyze \
     --runtime nodejs20 \
     --trigger-http \
     --allow-unauthenticated \
     --set-env-vars GENAI_TOKEN=$GENAI_TOKEN,GENAI_URL=https://genai-us.geotab.com/api/v2
   ```

3. Note the deployed function URL (e.g., `https://us-central1-YOUR_PROJECT.cloudfunctions.net/analyze`)

4. Test the function:
   ```bash
   curl -X POST https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/analyze \
     -H "Content-Type: application/json" \
     -d '{"prompt":"What is fault code P0300?"}'
   ```

### Step 2: Update Add-In Configuration

1. Open `addin/main.js` and update the `AI_ENDPOINT` constant with your Cloud Function URL:
   ```javascript
   const AI_ENDPOINT = 'https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/analyze';
   ```

### Step 3: Host Add-In Files

Option A: Google Cloud Storage (Recommended)
```bash
# Create a bucket
gsutil mb gs://YOUR_BUCKET_NAME

# Enable public access
gsutil iam ch allUsers:objectViewer gs://YOUR_BUCKET_NAME

# Upload files
gsutil cp addin/* gs://YOUR_BUCKET_NAME/
```

Option B: Any HTTPS server
- Upload the `addin/` folder contents to any HTTPS web server
- GitHub Pages, Netlify, Vercel, etc.

### Step 4: Update configuration.json

Update `addin/configuration.json` with your hosting URLs:
```json
{
    "items": [
        {
            "icon": "https://storage.googleapis.com/YOUR_BUCKET_NAME/icon.svg",
            "url": "https://storage.googleapis.com/YOUR_BUCKET_NAME/index.html"
        }
    ]
}
```

Re-upload `configuration.json` after updating.

### Step 5: Install Add-In in MyGeotab

1. Log in to MyGeotab
2. Go to **Administration > System Settings > Add-Ins**
3. Click **Add** and enter your `configuration.json` URL
4. Save and refresh

### Step 6: Verify Installation

1. Navigate to **Maintenance > AI Diagnostics** in MyGeotab
2. Select a vehicle and fetch fault codes
3. Click "Analyze with AI" on any fault code
4. Verify AI analysis appears

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GENAI_TOKEN` | GenAI Gateway JWT token | Required |
| `GENAI_URL` | GenAI Gateway URL | `https://genai-us.geotab.com/api/v2` |

## Cost Estimate

**Google Cloud Function:**
- Free tier: 2M invocations/month
- Typical usage: ~100 analyses/month = $0

**Google Cloud Storage (for hosting Add-In):**
- Free tier: 5GB storage, 1GB egress/day
- Add-In files: ~100KB = $0

## Troubleshooting

### AI Analysis Not Working

1. Check Cloud Function logs:
   ```bash
   gcloud functions logs read analyze --limit 50
   ```

2. Verify GENAI_TOKEN is set:
   ```bash
   gcloud functions describe analyze --format="value(environmentVariables)"
   ```

3. Test the function directly with curl

### Add-In Not Loading

1. Verify CORS headers are set in Cloud Function
2. Check browser console for errors
3. Ensure all Add-In files are accessible via HTTPS
4. Verify configuration.json URLs are correct

### Vehicle Data Not Loading

1. Ensure you have the correct MyGeotab permissions
2. Check browser console for API errors
3. Verify the Add-In is properly registered

## License

MIT
