#!/bin/bash

# Airtable MCP Server Quick Start Script

set -e

echo "🚀 Starting Airtable MCP Server setup..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
AIRTABLE_CLIENT_ID=your_client_id_here
AIRTABLE_CLIENT_SECRET=your_client_secret_here
AIRTABLE_REDIRECT_URI=http://localhost:8006/auth/callback
PORT=8006
EOF
    echo "✅ Created .env file. Please update it with your Airtable OAuth credentials."
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build widgets
echo "🔨 Building widgets..."
npm run build:widgets

# Build server
echo "🔨 Building server..."
npm run build:server

echo "✅ Setup complete!"
echo ""
echo "To start the server:"
echo "  npm run dev"
echo ""
echo "Make sure to:"
echo "  1. Update .env with your Airtable OAuth credentials"
echo "  2. Set up your Airtable OAuth app at https://airtable.com/create/oauth"
echo "  3. Configure the redirect URI: http://localhost:8006/auth/callback"

