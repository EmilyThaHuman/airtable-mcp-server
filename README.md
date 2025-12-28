# Airtable MCP Server

Model Context Protocol server for Airtable integration with ChatGPT Apps SDK.

## Features

- Full OAuth 2.0 authentication flow with Airtable
- 30+ Airtable tools (CRUD, schema, bulk operations, views, attachments, comments)
- 5 UI widgets using `@openai/apps-sdk-ui`:
  - List Records
  - Create Records
  - Update Record
  - Get Record
  - Create Comment
- SSE-based MCP protocol communication
- Docker + Railway deployment ready

## Prerequisites

- Node.js 18+
- Airtable OAuth app credentials
- Environment variables configured

## Installation

```bash
npm install
```

## Environment Variables

```bash
AIRTABLE_CLIENT_ID=your_client_id
AIRTABLE_CLIENT_SECRET=your_client_secret
AIRTABLE_REDIRECT_URI=http://localhost:8006/auth/callback
PORT=8006
```

## Development

```bash
# Run development server
npm run dev

# Build server and widgets
npm run build

# Build server only
npm run build:server

# Build widgets only
npm run build:widgets
```

## Deployment

The server is configured for Railway deployment with Docker. Set the environment variables in your Railway project.

## Design Philosophy

This MCP server follows Airtable's mental model of **three layers**:

1. **UI is a projection** - Views show data but agents don't manipulate UI state
2. **Views are lenses** - Agents query through views but don't modify view definitions  
3. **Agents mutate data; humans manipulate presentation** - Clear separation of concerns

### UI Widget Philosophy

- **`list_records`** - Read-only grid-style projection of records. Agents can query and view, but UI state (filters, sorts) is human-controlled.
- **`get_record`** - Record Detail Panel showing all fields, attachments, and metadata. Agents can read and trigger updates.
- **`create_record` / `update_record`** - Data mutation forms. Agents write data directly.
- **`create_comment`** - Comments Panel as the **shared handoff surface** between agents and humans. This is where agents communicate status, questions, and context.

**Key Principle:** Let agents write data, let humans curate views. Comments serve as the collaborative bridge.

## Tools

### Schema & Discovery
- `list_bases` - Get all accessible bases
- `get_base_schema` - Full schema with tables/fields
- `list_tables` - Tables in a base
- `list_fields` - Fields in a table
- `list_views` - Views for a table

### Record Operations
- `list_records` - Query with filters/sorting/pagination ⭐ **HAS UI**
- `get_record` - Single record by ID ⭐ **HAS UI**
- `create_record` - Insert new record ⭐ **HAS UI**
- `update_record` - Partial update (PATCH) ⭐ **HAS UI**
- `replace_record` - Full replace (PUT)
- `delete_record` - Delete by ID

### Bulk Operations
- `batch_create_records` - Create multiple records
- `batch_update_records` - Update multiple records
- `batch_delete_records` - Delete multiple records

### Query & Views
- `query_records` - Advanced filtering with formulas
- `get_view_records` - Records as view defines them

### Attachments
- `upload_attachment` - Upload file to attachment field
- `list_attachments` - Get attachments from record

### Comments
- `get_comments` - Retrieve record comments
- `create_comment` - Post comment on record ⭐ **HAS UI**

### Composite Tools
- `upsert_record` - Create or update based on unique key
- `validate_schema_compatibility` - Check field type compatibility

## License

MIT

