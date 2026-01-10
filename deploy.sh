#!/bin/bash
set -e

# ============================================================
# Google Drive MCP Deployment Script (Cloud Functions)
# ============================================================

PROJECT_ID="${GCP_PROJECT:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
FUNCTION_NAME="google-drive-mcp"

echo "============================================"
echo "Google Drive MCP Deployment (Cloud Functions)"
echo "============================================"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check required env vars
if [ -z "$ALLOWED_EMAIL" ]; then
    echo "Error: ALLOWED_EMAIL environment variable required"
    exit 1
fi

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null 2>&1; then
    echo "Error: Not authenticated with gcloud. Run: gcloud auth login"
    exit 1
fi

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    drive.googleapis.com \
    docs.googleapis.com \
    sheets.googleapis.com \
    secretmanager.googleapis.com \
    --quiet

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Deploy to Cloud Functions Gen 2
echo "Deploying to Cloud Functions..."
gcloud functions deploy "$FUNCTION_NAME" \
    --gen2 \
    --runtime=nodejs20 \
    --region="$REGION" \
    --source=. \
    --entry-point=googleDriveMcp \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars="ALLOWED_EMAIL=$ALLOWED_EMAIL" \
    --set-secrets="GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,JWT_SECRET=jwt-secret:latest" \
    --memory=512Mi \
    --timeout=60s

# Get the function URL
FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" --region "$REGION" --gen2 --format="value(serviceConfig.uri)")

# Update function with BASE_URL
echo "Setting BASE_URL environment variable..."
gcloud functions deploy "$FUNCTION_NAME" \
    --gen2 \
    --region="$REGION" \
    --update-env-vars="BASE_URL=$FUNCTION_URL"

echo ""
echo "============================================"
echo "Deployment Complete!"
echo "============================================"
echo ""
echo "Function URL: $FUNCTION_URL"
echo ""
echo "SETUP CHECKLIST:"
echo "============================================"
echo ""
echo "1. Create OAuth credentials at:"
echo "   https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
echo "   Authorized redirect URI: ${FUNCTION_URL}/oauth/callback"
echo ""
echo "2. Store secrets (if not already done):"
echo ""
echo "   echo -n 'YOUR_CLIENT_ID' | gcloud secrets create oauth-client-id --data-file=-"
echo "   echo -n 'YOUR_CLIENT_SECRET' | gcloud secrets create oauth-client-secret --data-file=-"
echo "   echo -n '\$(uuidgen)' | gcloud secrets create jwt-secret --data-file=-"
echo ""
echo "3. Add to Claude Web:"
echo "   Settings > Integrations > Add MCP server"
echo "   URL: $FUNCTION_URL"
echo ""
