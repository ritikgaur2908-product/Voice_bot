import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  initDb,
  createBooking,
  updateBooking,
  deleteBooking,
  lookupBooking,
  listAllBookings,
  getBookedSlots,
} from "./db.js";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "./calendar.js";
import {
  appendLedgerRecord,
  updateLedgerRecord,
} from "./notes.js";
import {
  createGmailDraft,
  updateGmailDraft,
} from "./email.js";

// Initialize server
const server = new Server(
  {
    name: "appointment-scheduler-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mcp_db_sync_booking",
        description: "Sync booking records with local SQLite database (CRUD operations)",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create", "update", "delete", "lookup", "list"],
              description: "The SQLite operation to execute",
            },
            booking_code: {
              type: "string",
              description: "The unique booking code (e.g. AA-1234)",
            },
            topic: {
              type: "string",
              description: "The booking topic / subject",
            },
            date: {
              type: "string",
              description: "The date of the appointment (YYYY-MM-DD)",
            },
            time: {
              type: "string",
              description: "The time of the appointment (HH:MM)",
            },
            timezone: {
              type: "string",
              description: "Timezone of the booking (defaults to IST)",
            },
            status: {
              type: "string",
              description: "Status of booking (TENTATIVE, CONFIRMED, WAITLIST, CANCELLED)",
            },
          },
          required: ["operation"],
        },
      },
      {
        name: "mcp_calendar_create_event",
        description: "Create an event on Google Calendar representing a tentative hold",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            time: { type: "string", description: "HH:MM" },
            booking_code: { type: "string" },
            status: { type: "string" },
          },
          required: ["topic", "date", "time", "booking_code"],
        },
      },
      {
        name: "mcp_calendar_update_event",
        description: "Update an existing Google Calendar event details",
        inputSchema: {
          type: "object",
          properties: {
            booking_code: { type: "string" },
            new_topic: { type: "string" },
            new_date: { type: "string", description: "YYYY-MM-DD" },
            new_time: { type: "string", description: "HH:MM" },
            new_status: { type: "string" },
          },
          required: ["booking_code", "new_topic", "new_date", "new_time", "new_status"],
        },
      },
      {
        name: "mcp_calendar_delete_event",
        description: "Delete an existing Google Calendar event hold",
        inputSchema: {
          type: "object",
          properties: {
            booking_code: { type: "string" },
          },
          required: ["booking_code"],
        },
      },
      {
        name: "mcp_notes_append_record",
        description: "Append a new pre-booking record row in the ledger spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            time: { type: "string", description: "HH:MM" },
            topic: { type: "string" },
            booking_code: { type: "string" },
            status: { type: "string" },
          },
          required: ["date", "time", "topic", "booking_code"],
        },
      },
      {
        name: "mcp_notes_update_record",
        description: "Update status or details of a record row in the ledger spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            booking_code: { type: "string" },
            status: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            time: { type: "string", description: "HH:MM" },
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            notes: { type: "string" },
          },
          required: ["booking_code", "status"],
        },
      },
      {
        name: "mcp_email_create_draft",
        description: "Create an email draft notification in Gmail (pre-filled with PENDING status)",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            time: { type: "string", description: "HH:MM" },
            booking_code: { type: "string" },
            status: { type: "string" },
          },
          required: ["topic", "date", "time", "booking_code"],
        },
      },
      {
        name: "mcp_email_update_draft",
        description: "Update an existing email draft notification in Gmail",
        inputSchema: {
          type: "object",
          properties: {
            booking_code: { type: "string" },
            new_topic: { type: "string" },
            new_date: { type: "string", description: "YYYY-MM-DD" },
            new_time: { type: "string", description: "HH:MM" },
            new_status: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            notes: { type: "string" },
          },
          required: ["booking_code", "new_topic", "new_date", "new_time", "new_status"],
        },
      },
    ],
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "mcp_db_sync_booking": {
        const { operation, booking_code, topic, date, time, timezone, status } = (args || {}) as any;
        if (operation === "create") {
          if (!booking_code || !topic || !date || !time) {
            throw new McpError(ErrorCode.InvalidParams, "Missing required params for create booking");
          }
          const result = createBooking({ booking_code, topic, date, time, timezone, status });
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else if (operation === "update") {
          if (!booking_code) {
            throw new McpError(ErrorCode.InvalidParams, "Missing booking_code for update booking");
          }
          const result = updateBooking(booking_code, { topic, date, time, timezone, status });
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else if (operation === "delete") {
          if (!booking_code) {
            throw new McpError(ErrorCode.InvalidParams, "Missing booking_code for delete booking");
          }
          const result = deleteBooking(booking_code);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else if (operation === "lookup") {
          if (!booking_code) {
            throw new McpError(ErrorCode.InvalidParams, "Missing booking_code for lookup booking");
          }
          const result = lookupBooking(booking_code);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else if (operation === "list") {
          const result = listAllBookings();
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else if (operation === "booked_slots") {
          if (!date) {
            throw new McpError(ErrorCode.InvalidParams, "Missing date for booked_slots operation");
          }
          const result = getBookedSlots(date);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } else {
          throw new McpError(ErrorCode.InvalidParams, `Unknown db operation: ${operation}`);
        }
      }

      case "mcp_calendar_create_event": {
        const { topic, date, time, booking_code, status } = (args || {}) as any;
        const result = await createCalendarEvent(topic, date, time, booking_code, status);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_calendar_update_event": {
        const { booking_code, new_topic, new_date, new_time, new_status } = (args || {}) as any;
        const result = await updateCalendarEvent(booking_code, new_topic, new_date, new_time, new_status);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_calendar_delete_event": {
        const { booking_code } = (args || {}) as any;
        const result = await deleteCalendarEvent(booking_code);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_notes_append_record": {
        const { date, time, topic, booking_code, status } = (args || {}) as any;
        const result = await appendLedgerRecord(date, time, topic, booking_code, status);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_notes_update_record": {
        const { booking_code, status, date, time, name, email, phone, notes } = (args || {}) as any;
        const result = await updateLedgerRecord(booking_code, status, date, time, name, email, phone, notes);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_email_create_draft": {
        const { topic, date, time, booking_code, status } = (args || {}) as any;
        const result = await createGmailDraft(topic, date, time, booking_code, status);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case "mcp_email_update_draft": {
        const { booking_code, new_topic, new_date, new_time, new_status, name, email, phone, notes } = (args || {}) as any;
        const result = await updateGmailDraft(booking_code, new_topic, new_date, new_time, new_status, name, email, phone, notes);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message || String(error) }],
    };
  }
});

// Run server
async function run() {
  await initDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server successfully started on stdio transport!");
}

run().catch((error) => {
  console.error("Fatal error running MCP server:", error);
  process.exit(1);
});
