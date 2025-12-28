#!/bin/bash

# Railway deployment script for Airtable MCP Server
# This script helps set up and deploy to Railway

set -e

echo "🚂 Railway Deployment Script for Airtable MCP Server"
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI is not installed. Please install it first:"
    echo "   npm i -g @railway/cli"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "❌ Not logged in to Railway. Please run: railway login"
    exit 1
fi

echo "✅ Railway CLI is installed and you're logged in"
echo ""

# Check if project is already linked
if [ -f ".railway/project.json" ]; then
    echo "✅ Project is already linked to Railway"
    PROJECT_LINKED=true
else
    echo "⚠️  Project is not yet linked to Railway"
    echo "   You'll need to run: railway init"
    echo "   Then select 'ReedThaHuman's Projects' workspace"
    echo "   And create a new project called 'airtable-mcp-server'"
    PROJECT_LINKED=false
fi

echo ""
echo "📦 Setting environment variables..."

# Set environment variables
railway variables --set "AIRTABLE_CLIENT_ID=4a004486-5fe0-4c87-b7ed-6af1d74e8619" \
                   --set "AIRTABLE_CLIENT_SECRET=457ef84e2306eff78f26dbe3f9211f10c67a187b3dd3d82e7fc3d948266175a1" \
                   --set "AIRTABLE_REDIRECT_URI=https://zerotwo.ai/auth/callback" \
                   --set "PORT=8006"

echo ""
echo "✅ Environment variables set!"
echo ""
echo "🚀 Deploying to Railway..."
railway up

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Get your Railway deployment URL from: railway status"
echo "   2. Update AIRTABLE_REDIRECT_URI if needed"
echo "   3. Test the deployment"

