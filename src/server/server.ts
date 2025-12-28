import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Airtable OAuth configuration
const AIRTABLE_CLIENT_ID = process.env.AIRTABLE_CLIENT_ID || "";
const AIRTABLE_CLIENT_SECRET = process.env.AIRTABLE_CLIENT_SECRET || "";
const AIRTABLE_REDIRECT_URI = process.env.AIRTABLE_REDIRECT_URI || "http://localhost:8006/auth/callback";
const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

type AirtableWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

// Store OAuth state and tokens in memory (use database in production)
const authSessions = new Map<string, { accessToken: string; refreshToken: string; expiresAt: number }>();
const pendingAuthStates = new Map<string, { sessionId: string; createdAt: number }>();

function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    return `<html><body><div id="root"></div><script>console.error('Widget assets not built. Run npm run build:widgets');</script></body></html>`;
  }

  // Try direct path first
  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    // Check for versioned files like "component-hash.html"
    try {
      const candidates = fs
        .readdirSync(ASSETS_DIR)
        .filter(
          (file) => file.startsWith(`${componentName}-`) && file.endsWith(".html")
        )
        .sort();
      const fallback = candidates[candidates.length - 1];
      if (fallback) {
        htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
      } else {
        // Check in src/components subdirectory as fallback
        const nestedPath = path.join(ASSETS_DIR, "src", "components", `${componentName}.html`);
        if (fs.existsSync(nestedPath)) {
          htmlContents = fs.readFileSync(nestedPath, "utf8");
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read
    }
  }

  if (!htmlContents) {
    return `<html><body><div id="root"></div><script>console.error('Widget HTML for "${componentName}" not found. Run npm run build:widgets');</script></body></html>`;
  }

  return htmlContents;
}

function widgetMeta(widget: AirtableWidget) {
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

const widgets: AirtableWidget[] = [
  {
    id: "list-records",
    title: "List Records",
    templateUri: "ui://widget/list-records.html",
    invoking: "Loading Airtable records",
    invoked: "Loaded Airtable records",
    html: "",
    responseText: "Found Airtable records",
  },
  {
    id: "create-records",
    title: "Create Records",
    templateUri: "ui://widget/create-records.html",
    invoking: "Creating Airtable records",
    invoked: "Created Airtable records",
    html: "",
    responseText: "Created Airtable records",
  },
  {
    id: "update-record",
    title: "Update Record",
    templateUri: "ui://widget/update-record.html",
    invoking: "Updating Airtable record",
    invoked: "Updated Airtable record",
    html: "",
    responseText: "Updated Airtable record",
  },
  {
    id: "get-record",
    title: "Get Record",
    templateUri: "ui://widget/get-record.html",
    invoking: "Loading Airtable record",
    invoked: "Loaded Airtable record",
    html: "",
    responseText: "Found Airtable record",
  },
  {
    id: "create-comment",
    title: "Create Comment",
    templateUri: "ui://widget/create-comment.html",
    invoking: "Creating comment",
    invoked: "Created comment",
    html: "",
    responseText: "Created comment",
  },
];

const widgetsById = new Map<string, AirtableWidget>();
const widgetsByUri = new Map<string, AirtableWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
});

// OAuth helper functions
function generateAuthUrl(state: string): string {
  const scopes = [
    "data.records:read",
    "data.records:write",
    "data.recordComments:read",
    "data.recordComments:write",
    "schema.bases:read",
    "webhook:manage",
  ];

  const params = new URLSearchParams({
    client_id: AIRTABLE_CLIENT_ID,
    redirect_uri: AIRTABLE_REDIRECT_URI,
    response_type: "code",
    state: state,
    scope: scopes.join(" "),
  });

  return `https://airtable.com/oauth2/v1/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const response = await fetch("https://airtable.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: AIRTABLE_REDIRECT_URI,
      client_id: AIRTABLE_CLIENT_ID,
      client_secret: AIRTABLE_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange code for token: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const response = await fetch("https://airtable.com/oauth2/v1/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: AIRTABLE_CLIENT_ID,
      client_secret: AIRTABLE_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function getValidAccessToken(sessionId: string): Promise<string> {
  const session = authSessions.get(sessionId);
  
  if (!session) {
    throw new Error("Not authenticated. Please authenticate with Airtable first.");
  }

  // Check if token is expired (with 5 minute buffer)
  if (Date.now() >= session.expiresAt - 5 * 60 * 1000) {
    // Refresh the token
    const tokenData = await refreshAccessToken(session.refreshToken);
    session.accessToken = tokenData.access_token;
    session.expiresAt = Date.now() + tokenData.expires_in * 1000;
    authSessions.set(sessionId, session);
  }

  return session.accessToken;
}

async function airtableApiRequest(
  sessionId: string,
  endpoint: string,
  method: string = "GET",
  body?: any,
  accessTokenOverride?: string
): Promise<any> {
  const accessToken = accessTokenOverride || await getValidAccessToken(sessionId);
  
  const response = await fetch(`${AIRTABLE_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airtable API error: ${response.status} ${error}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// Tool input schemas using Zod
const listBasesSchema = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};

const getBaseSchemaSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
  },
  required: ["baseId"],
  additionalProperties: false,
};

const listTablesSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
  },
  required: ["baseId"],
  additionalProperties: false,
};

const listFieldsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
  },
  required: ["baseId", "tableId"],
  additionalProperties: false,
};

const listViewsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
  },
  required: ["baseId", "tableId"],
  additionalProperties: false,
};

const listRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    view: {
      type: "string" as const,
      description: "View name or ID to filter records",
    },
    filterByFormula: {
      type: "string" as const,
      description: "Airtable formula to filter records",
    },
    maxRecords: {
      type: "number" as const,
      description: "Maximum number of records to return (max 100)",
    },
    pageSize: {
      type: "number" as const,
      description: "Number of records per page (max 100)",
    },
    offset: {
      type: "string" as const,
      description: "Pagination offset token",
    },
    sort: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const },
          direction: { type: "string" as const, enum: ["asc", "desc"] },
        },
        required: ["field"],
      },
      description: "Sort order for records",
    },
    fields: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Fields to include in response",
    },
  },
  required: ["baseId", "tableId"],
  additionalProperties: false,
};

const getRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
  },
  required: ["baseId", "tableId", "recordId"],
  additionalProperties: false,
};

const createRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    fields: {
      type: "object" as const,
      description: "Field values for the new record",
    },
  },
  required: ["baseId", "tableId", "fields"],
  additionalProperties: false,
};

const updateRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
    fields: {
      type: "object" as const,
      description: "Field values to update",
    },
  },
  required: ["baseId", "tableId", "recordId", "fields"],
  additionalProperties: false,
};

const replaceRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
    fields: {
      type: "object" as const,
      description: "Complete field values to replace",
    },
  },
  required: ["baseId", "tableId", "recordId", "fields"],
  additionalProperties: false,
};

const deleteRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
  },
  required: ["baseId", "tableId", "recordId"],
  additionalProperties: false,
};

const batchCreateRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    records: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          fields: { type: "object" as const },
        },
        required: ["fields"],
      },
      description: "Array of records to create (max 10)",
    },
  },
  required: ["baseId", "tableId", "records"],
  additionalProperties: false,
};

const batchUpdateRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    records: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          fields: { type: "object" as const },
        },
        required: ["id", "fields"],
      },
      description: "Array of records to update (max 10)",
    },
  },
  required: ["baseId", "tableId", "records"],
  additionalProperties: false,
};

const batchDeleteRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordIds: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Array of record IDs to delete (max 10)",
    },
  },
  required: ["baseId", "tableId", "recordIds"],
  additionalProperties: false,
};

const queryRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    filterByFormula: {
      type: "string" as const,
      description: "Airtable formula to filter records",
    },
    view: {
      type: "string" as const,
      description: "View name or ID",
    },
    maxRecords: {
      type: "number" as const,
      description: "Maximum number of records (max 100)",
    },
    sort: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          field: { type: "string" as const },
          direction: { type: "string" as const, enum: ["asc", "desc"] },
        },
        required: ["field"],
      },
    },
    fields: {
      type: "array" as const,
      items: { type: "string" as const },
    },
  },
  required: ["baseId", "tableId"],
  additionalProperties: false,
};

const getViewRecordsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    viewId: {
      type: "string" as const,
      description: "Airtable view ID or name",
    },
    maxRecords: {
      type: "number" as const,
      description: "Maximum number of records (max 100)",
    },
  },
  required: ["baseId", "tableId", "viewId"],
  additionalProperties: false,
};

const uploadAttachmentSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
    fieldName: {
      type: "string" as const,
      description: "Attachment field name",
    },
    url: {
      type: "string" as const,
      description: "URL of the file to attach",
    },
    filename: {
      type: "string" as const,
      description: "Filename for the attachment",
    },
  },
  required: ["baseId", "tableId", "recordId", "fieldName", "url"],
  additionalProperties: false,
};

const listAttachmentsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
    fieldName: {
      type: "string" as const,
      description: "Attachment field name",
    },
  },
  required: ["baseId", "tableId", "recordId", "fieldName"],
  additionalProperties: false,
};

const getCommentsSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
  },
  required: ["baseId", "tableId", "recordId"],
  additionalProperties: false,
};

const createCommentSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    recordId: {
      type: "string" as const,
      description: "Airtable record ID",
    },
    text: {
      type: "string" as const,
      description: "Comment text",
    },
  },
  required: ["baseId", "tableId", "recordId", "text"],
  additionalProperties: false,
};

const upsertRecordSchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    fields: {
      type: "object" as const,
      description: "Field values",
    },
    typecast: {
      type: "boolean" as const,
      description: "Whether to enable typecasting",
    },
    uniqueField: {
      type: "string" as const,
      description: "Field name to match for upsert",
    },
    uniqueValue: {
      type: "string" as const,
      description: "Value to match in uniqueField",
    },
  },
  required: ["baseId", "tableId", "fields", "uniqueField", "uniqueValue"],
  additionalProperties: false,
};

const validateSchemaCompatibilitySchema = {
  type: "object" as const,
  properties: {
    baseId: {
      type: "string" as const,
      description: "Airtable base ID",
    },
    tableId: {
      type: "string" as const,
      description: "Airtable table ID or name",
    },
    fields: {
      type: "object" as const,
      description: "Field values to validate",
    },
  },
  required: ["baseId", "tableId", "fields"],
  additionalProperties: false,
};

// Zod parsers
const listBasesParser = z.object({});

const getBaseSchemaParser = z.object({
  baseId: z.string(),
});

const listTablesParser = z.object({
  baseId: z.string(),
});

const listFieldsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

const listViewsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
});

const listRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  view: z.string().optional(),
  filterByFormula: z.string().optional(),
  maxRecords: z.number().max(100).optional(),
  pageSize: z.number().max(100).optional(),
  offset: z.string().optional(),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional(),
  fields: z.array(z.string()).optional(),
});

const getRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
});

const createRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fields: z.record(z.unknown()),
});

const updateRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  fields: z.record(z.unknown()),
});

const replaceRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  fields: z.record(z.unknown()),
});

const deleteRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
});

const batchCreateRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  records: z.array(z.object({
    fields: z.record(z.unknown()),
  })).max(10),
});

const batchUpdateRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  records: z.array(z.object({
    id: z.string(),
    fields: z.record(z.unknown()),
  })).max(10),
});

const batchDeleteRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordIds: z.array(z.string()).max(10),
});

const queryRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  filterByFormula: z.string().optional(),
  view: z.string().optional(),
  maxRecords: z.number().max(100).optional(),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional(),
  fields: z.array(z.string()).optional(),
});

const getViewRecordsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  viewId: z.string(),
  maxRecords: z.number().max(100).optional(),
});

const uploadAttachmentParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  fieldName: z.string(),
  url: z.string(),
  filename: z.string().optional(),
});

const listAttachmentsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  fieldName: z.string(),
});

const getCommentsParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
});

const createCommentParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  recordId: z.string(),
  text: z.string(),
});

const upsertRecordParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fields: z.record(z.unknown()),
  typecast: z.boolean().optional(),
  uniqueField: z.string(),
  uniqueValue: z.string(),
});

const validateSchemaCompatibilityParser = z.object({
  baseId: z.string(),
  tableId: z.string(),
  fields: z.record(z.unknown()),
});

const tools: Tool[] = [
  {
    name: "list_bases",
    description: "Retrieve all Airtable bases accessible by the authenticated user.",
    inputSchema: listBasesSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "get_base_schema",
    description: "Fetch full schema metadata for a base, including tables, fields, field types, formulas, linked records, and views.",
    inputSchema: getBaseSchemaSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "list_tables",
    description: "Return all tables within a given base.",
    inputSchema: listTablesSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "list_fields",
    description: "List all fields for a specific table, including type, options, and constraints.",
    inputSchema: listFieldsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "list_views",
    description: "List all views for a table (Grid, Kanban, Calendar, etc.).",
    inputSchema: listViewsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "list_records",
    description: "Query records from a table with optional filters, sorting, pagination, and view selection.",
    inputSchema: listRecordsSchema,
    _meta: widgetMeta(widgetsById.get("list-records")!),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "get_record",
    description: "Retrieve a single record by record ID.",
    inputSchema: getRecordSchema,
    _meta: widgetMeta(widgetsById.get("get-record")!),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "create_record",
    description: "Insert a new record into a table with specified field values.",
    inputSchema: createRecordSchema,
    _meta: widgetMeta(widgetsById.get("create-records")!),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "update_record",
    description: "Update one or more fields on an existing record (partial update / PATCH semantics).",
    inputSchema: updateRecordSchema,
    _meta: widgetMeta(widgetsById.get("update-record")!),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "replace_record",
    description: "Replace all fields on a record (PUT semantics). Use with caution.",
    inputSchema: replaceRecordSchema,
    annotations: {
      destructiveHint: true,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "delete_record",
    description: "Delete a record by ID. This action is irreversible.",
    inputSchema: deleteRecordSchema,
    annotations: {
      destructiveHint: true,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "batch_create_records",
    description: "Create multiple records in a single request (up to 10 records per request).",
    inputSchema: batchCreateRecordsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "batch_update_records",
    description: "Update multiple records at once (up to 10 records per request).",
    inputSchema: batchUpdateRecordsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "batch_delete_records",
    description: "Delete multiple records in a single operation (up to 10 records per request).",
    inputSchema: batchDeleteRecordsSchema,
    annotations: {
      destructiveHint: true,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "query_records",
    description: "High-level wrapper around list_records that supports filterByFormula, view-based filtering, field projection, sorting, and pagination.",
    inputSchema: queryRecordsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "get_view_records",
    description: "Retrieve records exactly as a view defines them (filters, sorts, hidden fields).",
    inputSchema: getViewRecordsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "upload_attachment",
    description: "Upload a file and attach it to an attachment-type field on a record.",
    inputSchema: uploadAttachmentSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "list_attachments",
    description: "Enumerate attachments on a record or field.",
    inputSchema: listAttachmentsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "get_comments",
    description: "Retrieve comments for a record (where enabled).",
    inputSchema: getCommentsSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "create_comment",
    description: "Post a comment on a record.",
    inputSchema: createCommentSchema,
    _meta: widgetMeta(widgetsById.get("create-comment")!),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "upsert_record",
    description: "Create or update a record based on a unique key (email, external_id, etc.).",
    inputSchema: upsertRecordSchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "validate_schema_compatibility",
    description: "Check whether proposed writes match field types and constraints.",
    inputSchema: validateSchemaCompatibilitySchema,
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
];

const resources: Resource[] = Array.from(widgetsById.values()).map((widget) => ({
  uri: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

const resourceTemplates: ResourceTemplate[] = Array.from(widgetsById.values()).map((widget) => ({
  uriTemplate: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

function createAirtableServer(sessionId: string): Server {
  const server = new Server(
    {
      name: "airtable-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => ({
      resources,
    })
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request: ReadResourceRequest) => {
      const widget = widgetsByUri.get(request.params.uri);

      if (!widget) {
        throw new Error(`Unknown resource: ${request.params.uri}`);
      }

      // Load HTML lazily when requested
      const html = widget.html || readWidgetHtml(widget.id);

      return {
        contents: [
          {
            uri: widget.templateUri,
            mimeType: "text/html+skybridge",
            text: html,
            _meta: widgetMeta(widget),
          },
        ],
      };
    }
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({
      resourceTemplates,
    })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({
      tools,
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const toolName = request.params.name;

      // Check authentication for all tools
      let accessToken: string | null = null;
      
      if (authSessions.has(sessionId)) {
        accessToken = await getValidAccessToken(sessionId);
      } else {
        // Fallback: Check for Authorization header stored in session (from HTTP request)
        const storedAuthHeader = sessionAuthHeaders.get(sessionId);
        if (storedAuthHeader && storedAuthHeader.startsWith("Bearer ")) {
          accessToken = storedAuthHeader.substring(7);
          // Store in session for future use (without refresh token - will need re-auth when expired)
          authSessions.set(sessionId, {
            accessToken: accessToken,
            refreshToken: "", // We don't have refresh token from header
            expiresAt: Date.now() + 3600000, // Assume 1 hour expiration
          });
        }
      }

      if (!accessToken) {
        // Generate auth URL
        const state = crypto.randomBytes(16).toString("hex");
        pendingAuthStates.set(state, { sessionId, createdAt: Date.now() });
        const authUrl = generateAuthUrl(state);

        return {
          content: [
            {
              type: "text",
              text: `Please authenticate with Airtable to use this feature. Visit: ${authUrl}`,
            },
          ],
        };
      }

      switch (toolName) {
        case "list_bases": {
          const data = await airtableApiRequest(sessionId, "/meta/bases", "GET", undefined, accessToken);
          return {
            content: [
              {
                type: "text",
                text: `Found ${data.bases?.length || 0} accessible bases.`,
              },
            ],
            structuredContent: {
              bases: data.bases || [],
            },
          };
        }

        case "get_base_schema": {
          const args = getBaseSchemaParser.parse(request.params.arguments ?? {});
          const data = await airtableApiRequest(sessionId, `/meta/bases/${args.baseId}/tables`, "GET", undefined, accessToken);
          return {
            content: [
              {
                type: "text",
                text: `Retrieved schema for base ${args.baseId} with ${data.tables?.length || 0} tables.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tables: data.tables || [],
            },
          };
        }

        case "list_tables": {
          const args = listTablesParser.parse(request.params.arguments ?? {});
          const data = await airtableApiRequest(sessionId, `/meta/bases/${args.baseId}/tables`, "GET", undefined, accessToken);
          return {
            content: [
              {
                type: "text",
                text: `Found ${data.tables?.length || 0} tables in base ${args.baseId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tables: data.tables?.map((t: any) => ({ id: t.id, name: t.name })) || [],
            },
          };
        }

        case "list_fields": {
          const args = listFieldsParser.parse(request.params.arguments ?? {});
          const data = await airtableApiRequest(sessionId, `/meta/bases/${args.baseId}/tables/${args.tableId}`, "GET", undefined, accessToken);
          return {
            content: [
              {
                type: "text",
                text: `Found ${data.fields?.length || 0} fields in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              fields: data.fields || [],
            },
          };
        }

        case "list_views": {
          const args = listViewsParser.parse(request.params.arguments ?? {});
          const data = await airtableApiRequest(sessionId, `/meta/bases/${args.baseId}/tables/${args.tableId}`, "GET", undefined, accessToken);
          return {
            content: [
              {
                type: "text",
                text: `Found ${data.views?.length || 0} views in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              views: data.views || [],
            },
          };
        }

        case "list_records": {
          const args = listRecordsParser.parse(request.params.arguments ?? {});
          const widget = widgetsById.get("list-records")!;
          
          const params = new URLSearchParams();
          if (args.view) params.append("view", args.view);
          if (args.filterByFormula) params.append("filterByFormula", args.filterByFormula);
          if (args.maxRecords) params.append("maxRecords", args.maxRecords.toString());
          if (args.pageSize) params.append("pageSize", args.pageSize.toString());
          if (args.offset) params.append("offset", args.offset);
          if (args.sort) {
            args.sort.forEach((s: any) => {
              params.append("sort[]", JSON.stringify({ field: s.field, direction: s.direction || "asc" }));
            });
          }
          if (args.fields) {
            args.fields.forEach((f: string) => {
              params.append("fields[]", f);
            });
          }

          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}?${params.toString()}`,
            "GET",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Found ${data.records?.length || 0} records in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              records: data.records || [],
              offset: data.offset,
            },
            _meta: widgetMeta(widget),
          };
        }

        case "get_record": {
          const args = getRecordParser.parse(request.params.arguments ?? {});
          const widget = widgetsById.get("get-record")!;
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "GET",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Retrieved record ${args.recordId} from table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              record: data,
            },
            _meta: widgetMeta(widget),
          };
        }

        case "create_record": {
          const args = createRecordParser.parse(request.params.arguments ?? {});
          const widget = widgetsById.get("create-records")!;
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}`,
            "POST",
            { fields: args.fields },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully created record in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              record: data,
            },
            _meta: widgetMeta(widget),
          };
        }

        case "update_record": {
          const args = updateRecordParser.parse(request.params.arguments ?? {});
          const widget = widgetsById.get("update-record")!;
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "PATCH",
            { fields: args.fields },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully updated record ${args.recordId} in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              recordId: args.recordId,
              record: data,
            },
            _meta: widgetMeta(widget),
          };
        }

        case "replace_record": {
          const args = replaceRecordParser.parse(request.params.arguments ?? {});
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "PUT",
            { fields: args.fields },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully replaced record ${args.recordId} in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              recordId: args.recordId,
              record: data,
            },
          };
        }

        case "delete_record": {
          const args = deleteRecordParser.parse(request.params.arguments ?? {});
          
          await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "DELETE",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted record ${args.recordId} from table ${args.tableId}.`,
              },
            ],
          };
        }

        case "batch_create_records": {
          const args = batchCreateRecordsParser.parse(request.params.arguments ?? {});
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}`,
            "POST",
            { records: args.records },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully created ${data.records?.length || 0} records in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              records: data.records || [],
            },
          };
        }

        case "batch_update_records": {
          const args = batchUpdateRecordsParser.parse(request.params.arguments ?? {});
          
          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}`,
            "PATCH",
            { records: args.records },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully updated ${data.records?.length || 0} records in table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              records: data.records || [],
            },
          };
        }

        case "batch_delete_records": {
          const args = batchDeleteRecordsParser.parse(request.params.arguments ?? {});
          
          const params = new URLSearchParams();
          args.recordIds.forEach((id: string) => {
            params.append("records[]", id);
          });

          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}?${params.toString()}`,
            "DELETE",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully deleted ${args.recordIds.length} records from table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              deleted: data.records || [],
            },
          };
        }

        case "query_records": {
          const args = queryRecordsParser.parse(request.params.arguments ?? {});
          
          const params = new URLSearchParams();
          if (args.filterByFormula) params.append("filterByFormula", args.filterByFormula);
          if (args.view) params.append("view", args.view);
          if (args.maxRecords) params.append("maxRecords", args.maxRecords.toString());
          if (args.sort) {
            args.sort.forEach((s: any) => {
              params.append("sort[]", JSON.stringify({ field: s.field, direction: s.direction || "asc" }));
            });
          }
          if (args.fields) {
            args.fields.forEach((f: string) => {
              params.append("fields[]", f);
            });
          }

          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}?${params.toString()}`,
            "GET",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Query returned ${data.records?.length || 0} records from table ${args.tableId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              records: data.records || [],
              offset: data.offset,
            },
          };
        }

        case "get_view_records": {
          const args = getViewRecordsParser.parse(request.params.arguments ?? {});
          
          const params = new URLSearchParams();
          params.append("view", args.viewId);
          if (args.maxRecords) params.append("maxRecords", args.maxRecords.toString());

          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}?${params.toString()}`,
            "GET",
            undefined,
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `View ${args.viewId} contains ${data.records?.length || 0} records.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              viewId: args.viewId,
              records: data.records || [],
            },
          };
        }

        case "upload_attachment": {
          const args = uploadAttachmentParser.parse(request.params.arguments ?? {});
          
          // Get current record to append attachment
          const record = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "GET",
            undefined,
            accessToken
          );

          const currentAttachments = (record.fields[args.fieldName] as any[]) || [];
          const newAttachment = {
            url: args.url,
            filename: args.filename || args.url.split('/').pop() || "attachment",
          };

          const updatedFields = {
            [args.fieldName]: [...currentAttachments, newAttachment],
          };

          const data = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "PATCH",
            { fields: updatedFields },
            accessToken
          );

          return {
            content: [
              {
                type: "text",
                text: `Successfully attached file to record ${args.recordId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              recordId: args.recordId,
              attachment: newAttachment,
            },
          };
        }

        case "list_attachments": {
          const args = listAttachmentsParser.parse(request.params.arguments ?? {});
          
          const record = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}/${args.recordId}`,
            "GET",
            undefined,
            accessToken
          );

          const attachments = (record.fields[args.fieldName] as any[]) || [];

          return {
            content: [
              {
                type: "text",
                text: `Found ${attachments.length} attachments on record ${args.recordId}.`,
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              recordId: args.recordId,
              fieldName: args.fieldName,
              attachments: attachments,
            },
          };
        }

        case "get_comments": {
          const args = getCommentsParser.parse(request.params.arguments ?? {});
          
          // Note: Airtable comments API may require different endpoint
          // This is a placeholder implementation
          try {
            const data = await airtableApiRequest(
              sessionId,
              `/${args.baseId}/${args.tableId}/${args.recordId}/comments`,
              "GET",
              undefined,
              accessToken
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${data.comments?.length || 0} comments on record ${args.recordId}.`,
                },
              ],
              structuredContent: {
                baseId: args.baseId,
                tableId: args.tableId,
                recordId: args.recordId,
                comments: data.comments || [],
              },
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text",
                  text: `Comments API not available or record does not support comments: ${error.message}`,
                },
              ],
            };
          }
        }

        case "create_comment": {
          const args = createCommentParser.parse(request.params.arguments ?? {});
          const widget = widgetsById.get("create-comment")!;
          
          try {
            const data = await airtableApiRequest(
              sessionId,
              `/${args.baseId}/${args.tableId}/${args.recordId}/comments`,
              "POST",
              { text: args.text },
              accessToken
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully created comment on record ${args.recordId}.`,
                },
              ],
              structuredContent: {
                baseId: args.baseId,
                tableId: args.tableId,
                recordId: args.recordId,
                comment: data,
              },
              _meta: widgetMeta(widget),
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to create comment: ${error.message}`,
                },
              ],
            };
          }
        }

        case "upsert_record": {
          const args = upsertRecordParser.parse(request.params.arguments ?? {});
          
          // First, try to find existing record
          const searchParams = new URLSearchParams();
          searchParams.append("filterByFormula", `{${args.uniqueField}}="${args.uniqueValue}"`);
          
          const searchResult = await airtableApiRequest(
            sessionId,
            `/${args.baseId}/${args.tableId}?${searchParams.toString()}`,
            "GET",
            undefined,
            accessToken
          );

          if (searchResult.records && searchResult.records.length > 0) {
            // Update existing record
            const recordId = searchResult.records[0].id;
            const data = await airtableApiRequest(
              sessionId,
              `/${args.baseId}/${args.tableId}/${recordId}`,
              "PATCH",
              { fields: args.fields, typecast: args.typecast },
              accessToken
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Updated existing record ${recordId} in table ${args.tableId}.`,
                },
              ],
              structuredContent: {
                baseId: args.baseId,
                tableId: args.tableId,
                recordId: recordId,
                record: data,
                action: "updated",
              },
            };
          } else {
            // Create new record
            const data = await airtableApiRequest(
              sessionId,
              `/${args.baseId}/${args.tableId}`,
              "POST",
              { fields: args.fields, typecast: args.typecast },
              accessToken
            );

            return {
              content: [
                {
                  type: "text",
                  text: `Created new record in table ${args.tableId}.`,
                },
              ],
              structuredContent: {
                baseId: args.baseId,
                tableId: args.tableId,
                record: data,
                action: "created",
              },
            };
          }
        }

        case "validate_schema_compatibility": {
          const args = validateSchemaCompatibilityParser.parse(request.params.arguments ?? {});
          
          // Get table schema
          const schema = await airtableApiRequest(
            sessionId,
            `/meta/bases/${args.baseId}/tables/${args.tableId}`,
            "GET",
            undefined,
            accessToken
          );

          const fieldMap = new Map(schema.fields.map((f: any) => [f.name, f]));
          const validationResults: any[] = [];

          for (const [fieldName, value] of Object.entries(args.fields)) {
            const field = fieldMap.get(fieldName);
            if (!field) {
              validationResults.push({
                field: fieldName,
                valid: false,
                error: "Field does not exist in table",
              });
              continue;
            }

            // Basic type validation
            let valid = true;
            let error = null;

            switch (field.type) {
              case "singleLineText":
              case "multilineText":
              case "email":
              case "url":
              case "phoneNumber":
                valid = typeof value === "string";
                if (!valid) error = `Expected string, got ${typeof value}`;
                break;
              case "number":
              case "percent":
              case "currency":
                valid = typeof value === "number";
                if (!valid) error = `Expected number, got ${typeof value}`;
                break;
              case "date":
              case "dateTime":
                valid = typeof value === "string";
                if (!valid) error = `Expected date string, got ${typeof value}`;
                break;
              case "checkbox":
                valid = typeof value === "boolean";
                if (!valid) error = `Expected boolean, got ${typeof value}`;
                break;
              case "multipleSelects":
              case "multipleRecordLinks":
                valid = Array.isArray(value);
                if (!valid) error = `Expected array, got ${typeof value}`;
                break;
            }

            validationResults.push({
              field: fieldName,
              valid,
              error,
              fieldType: field.type,
            });
          }

          const allValid = validationResults.every((r) => r.valid);

          return {
            content: [
              {
                type: "text",
                text: allValid
                  ? "All fields are compatible with the table schema."
                  : "Some fields are incompatible with the table schema.",
              },
            ],
            structuredContent: {
              baseId: args.baseId,
              tableId: args.tableId,
              valid: allValid,
              validationResults,
            },
          };
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    }
  );

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
  authHeader?: string;
};

const sessions = new Map<string, SessionRecord>();
const sessionAuthHeaders = new Map<string, string>();
const transportToSessionId = new Map<string, string>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";
const authCallbackPath = "/auth/callback";

async function handleSseRequest(res: ServerResponse, sessionId?: string, authHeader?: string) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const actualSessionId = sessionId || crypto.randomBytes(16).toString("hex");
  const server = createAirtableServer(actualSessionId);
  const transport = new SSEServerTransport(postPath, res);

  // Store mapping from transport.sessionId to actualSessionId
  transportToSessionId.set(transport.sessionId, actualSessionId);
  
  // Store auth header if provided
  if (authHeader) {
    sessionAuthHeaders.set(actualSessionId, authHeader);
  }

  sessions.set(transport.sessionId, { server, transport, authHeader });

  transport.onclose = async () => {
    const mappedSessionId = transportToSessionId.get(transport.sessionId);
    if (mappedSessionId) {
      sessionAuthHeaders.delete(mappedSessionId);
      transportToSessionId.delete(transport.sessionId);
    }
    sessions.delete(transport.sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(transport.sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  // Extract Authorization header from HTTP request and store in session
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader) {
    const authHeaderStr = typeof authHeader === "string" ? authHeader : authHeader[0];
    session.authHeader = authHeaderStr;
    const actualSessionId = transportToSessionId.get(sessionId);
    if (actualSessionId) {
      sessionAuthHeaders.set(actualSessionId, authHeaderStr);
    } else {
      sessionAuthHeaders.set(sessionId, authHeaderStr);
    }
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

async function handleAuthCallback(_req: IncomingMessage, res: ServerResponse, url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" }).end(`
      <html>
        <body>
          <h1>Authentication Failed</h1>
          <p>Error: ${error}</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
    return;
  }

  if (!code || !state) {
    res.writeHead(400).end("Missing code or state parameter");
    return;
  }

  const pendingAuth = pendingAuthStates.get(state);
  
  if (!pendingAuth) {
    res.writeHead(400).end("Invalid or expired state parameter");
    return;
  }

  // Clean up old states (older than 10 minutes)
  const now = Date.now();
  for (const [key, value] of pendingAuthStates.entries()) {
    if (now - value.createdAt > 10 * 60 * 1000) {
      pendingAuthStates.delete(key);
    }
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    
    authSessions.set(pendingAuth.sessionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    pendingAuthStates.delete(state);

    res.writeHead(200, { "Content-Type": "text/html" }).end(`
      <html>
        <body>
          <h1>Successfully Connected to Airtable!</h1>
          <p>You can now close this window and return to your chat.</p>
          <script>
            window.close();
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Failed to exchange code for token", error);
    res.writeHead(500, { "Content-Type": "text/html" }).end(`
      <html>
        <body>
          <h1>Authentication Error</h1>
          <p>${error.message}</p>
          <p>Please try again.</p>
        </body>
      </html>
    `);
  }
}

const portEnv = Number(process.env.PORT ?? 8006);
const port = Number.isFinite(portEnv) ? portEnv : 8006;

function setCorsHeaders(res: ServerResponse, origin?: string) {
  const allowedOrigins = ['https://zerotwo.ai', 'http://localhost:3000', 'http://localhost:5173'];
  const requestOrigin = origin || '*';
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : '*';
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    setCorsHeaders(res, origin);
    
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS" && (url.pathname === ssePath || url.pathname === postPath)) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === ssePath) {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      const authHeaderStr = authHeader ? (typeof authHeader === "string" ? authHeader : authHeader[0]) : undefined;
      await handleSseRequest(res, undefined, authHeaderStr);
      return;
    }

    if (req.method === "POST" && url.pathname === postPath) {
      await handlePostMessage(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === authCallbackPath) {
      await handleAuthCallback(req, res, url);
      return;
    }

    // Serve static assets for widgets
    if (req.method === "GET") {
      const assetPath = url.pathname.slice(1);
      const fullPath = path.join(ASSETS_DIR, assetPath);
      const resolvedPath = path.resolve(fullPath);
      
      if (!resolvedPath.startsWith(path.resolve(ASSETS_DIR))) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        const ext = path.extname(resolvedPath).toLowerCase();
        const contentTypes: { [key: string]: string } = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
        };
        const contentType = contentTypes[ext] || "application/octet-stream";
        
        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        });
        fs.createReadStream(resolvedPath).pipe(res);
        return;
      }
    }

    res.writeHead(404).end("Not Found");
  }
);

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`Airtable MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(`  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`);
  console.log(`  OAuth callback: GET http://localhost:${port}${authCallbackPath}`);
  console.log(`\nMake sure to set your environment variables:`);
  console.log(`  AIRTABLE_CLIENT_ID=<your_client_id>`);
  console.log(`  AIRTABLE_CLIENT_SECRET=<your_client_secret>`);
  console.log(`  AIRTABLE_REDIRECT_URI=${AIRTABLE_REDIRECT_URI}`);
});

