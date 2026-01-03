#!/bin/bash
set -e

# ============================================================
# MCP Drive Server Deployment Script
# ============================================================

# Configuration - UPDATE THESE VALUES
PROJECT_ID="${GCP_PROJECT:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="mcp-drive-server"

echo "============================================"
echo "MCP Drive Server Deployment"
echo "============================================"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

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
    run.googleapis.com \
    secretmanager.googleapis.com \
    firestore.googleapis.com \
    drive.googleapis.com \
    --quiet

# Check if Firestore is initialized
echo "Checking Firestore..."
if ! gcloud firestore databases describe --project="$PROJECT_ID" > /dev/null 2>&1; then
    echo "Creating Firestore database..."
    gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID"
fi

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
    --source . \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars "GCP_PROJECT=$PROJECT_ID" \
    --memory 512Mi \
    --timeout 60

# Get the service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format="value(status.url)")

echo ""
echo "============================================"
echo "Deployment Complete!"
echo "============================================"
echo ""
echo "Service URL: $SERVICE_URL"
echo ""
echo "IMPORTANT: Next Steps"
echo "============================================"
echo ""
echo "1. Create OAuth 2.0 credentials in Google Cloud Console:"
echo "   https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
echo "   - Click 'Create Credentials' > 'OAuth client ID'"
echo "   - Application type: 'Web application'"
echo "   - Name: 'MCP Drive Server'"
echo "   - Authorized redirect URIs: ${SERVICE_URL}/google/callback"
echo ""
echo "2. Store the OAuth credentials in Secret Manager:"
echo ""
echo "   # Store Client ID"
echo "   echo -n 'YOUR_CLIENT_ID' | gcloud secrets create oauth-client-id --data-file=-"
echo ""
echo "   # Store Client Secret"
echo "   echo -n 'YOUR_CLIENT_SECRET' | gcloud secrets create oauth-client-secret --data-file=-"
echo ""
echo "3. Update the Cloud Run service with BASE_URL:"
echo ""
echo "   gcloud run services update $SERVICE_NAME \\"
echo "       --region $REGION \\"
echo "       --set-env-vars \"BASE_URL=$SERVICE_URL,GCP_PROJECT=$PROJECT_ID\""
echo ""
echo "4. Grant Secret Manager access to Cloud Run service account:"
echo ""
echo "   SA_EMAIL=\$(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(spec.template.spec.serviceAccountName)')"
echo "   gcloud secrets add-iam-policy-binding oauth-client-id --member=\"serviceAccount:\$SA_EMAIL\" --role=\"roles/secretmanager.secretAccessor\""
echo "   gcloud secrets add-iam-policy-binding oauth-client-secret --member=\"serviceAccount:\$SA_EMAIL\" --role=\"roles/secretmanager.secretAccessor\""
echo ""
echo "5. Configure OAuth consent screen (if not already done):"
echo "   https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID"
echo ""
echo "   - User type: External (or Internal for Workspace)"
echo "   - Add scopes: drive.readonly, userinfo.email"
echo "   - Add your email as a test user"
echo ""
echo "6. Add to Claude Web:"
echo "   - Go to Claude settings > Integrations"
echo "   - Add MCP server with URL: ${SERVICE_URL}/mcp"
echo ""
