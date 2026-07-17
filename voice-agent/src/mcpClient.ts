import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from 'path';

let mcpClient: Client | null = null;
let transport: StdioClientTransport | null = null;

export async function getMcpClient(): Promise<Client> {
  if (mcpClient) return mcpClient;

  console.error("[MCP Client] Initializing connection to custom MCP server...");
  
  // Resolve the path to the mcp-server build output
  const mcpServerPath = path.resolve('../mcp-server/dist/index.js');
  
  transport = new StdioClientTransport({
    command: 'node',
    args: [mcpServerPath],
  });

  mcpClient = new Client(
    {
      name: "voice-agent-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await mcpClient.connect(transport);
  console.error("[MCP Client] Connected to custom MCP server successfully!");
  return mcpClient;
}

/**
 * Generates a unique booking code of format AA-XXXX and verifies uniqueness against SQLite.
 */
export async function generateUniqueBookingCode(): Promise<string> {
  const client = await getMcpClient();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";

  for (let attempt = 0; attempt < 5; attempt++) {
    let code = letters[Math.floor(Math.random() * 26)] + letters[Math.floor(Math.random() * 26)] + "-";
    for (let i = 0; i < 4; i++) {
      code += digits[Math.floor(Math.random() * 10)];
    }

    // Check database uniqueness
    const res = await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "lookup",
        booking_code: code
      }
    });

    const content = res.content as any[];
    if (!res.isError && (!content || !content[0]?.text || content[0].text === "null")) {
      return code; // Unique!
    }
  }

  throw new Error("Failed to generate unique booking code after 5 retries");
}

/**
 * Queries SQLite via MCP server to get all currently booked time slots for a specific date.
 */
export async function getBookedSlotsForDate(date: string): Promise<string[]> {
  try {
    const client = await getMcpClient();
    const res = await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "booked_slots",
        date: date
      }
    });
    const content = res.content as any[];
    if (!res.isError && content && content[0]?.text) {
      return JSON.parse(content[0].text);
    }
  } catch (err) {
    console.error("[MCP Client] Error fetching booked slots for date:", date, err);
  }
  return [];
}

/**
 * Executes a sequential booking sequence with transaction rollbacks on failure.
 */
export async function executeBookingTransaction(
  bookingCode: string,
  topic: string,
  date: string,
  time: string,
  status: string = 'TENTATIVE'
) {
  const client = await getMcpClient();
  let step = 0;

  try {
    // 1. SQLite DB Sync
    console.error(`[MCP Transaction] Step 1: SQLite Sync for ${bookingCode}`);
    step = 1;
    await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "create",
        booking_code: bookingCode,
        topic,
        date,
        time,
        timezone: "IST",
        status
      }
    });

    // 2. Google Calendar Hold
    console.error(`[MCP Transaction] Step 2: Google Calendar Event for ${bookingCode}`);
    step = 2;
    await client.callTool({
      name: "mcp_calendar_create_event",
      arguments: {
        topic,
        date,
        time,
        booking_code: bookingCode,
        status
      }
    });

    // 3. Google Sheets Ledger Row
    console.error(`[MCP Transaction] Step 3: Google Sheets Ledger entry for ${bookingCode}`);
    step = 3;
    await client.callTool({
      name: "mcp_notes_append_record",
      arguments: {
        date,
        time,
        topic,
        booking_code: bookingCode,
        status
      }
    });

    // 4. Gmail Notification Draft (Non-blocking)
    console.error(`[MCP Transaction] Step 4: Gmail Notification Draft for ${bookingCode}`);
    try {
      await client.callTool({
        name: "mcp_email_create_draft",
        arguments: {
          topic,
          date,
          time,
          booking_code: bookingCode,
          status
        }
      });
    } catch (emailError: any) {
      console.error("[MCP Transaction] Gmail draft creation failed (non-blocking):", emailError.message || emailError);
    }

    return { success: true };
  } catch (error: any) {
    console.error(`[MCP Transaction] Failed at step ${step}:`, error.message || error);
    await rollbackBooking(bookingCode, step);
    throw error;
  }
}

/**
 * Rolls back partially completed booking operations.
 */
async function rollbackBooking(bookingCode: string, failedStep: number) {
  console.error(`[MCP Transaction] Rolling back booking ${bookingCode} from failed step ${failedStep}`);
  const client = await getMcpClient();

  if (failedStep >= 3) {
    try {
      console.error(`[MCP Rollback] Deleting Google Calendar event for ${bookingCode}`);
      await client.callTool({
        name: "mcp_calendar_delete_event",
        arguments: { booking_code: bookingCode }
      });
    } catch (e: any) {
      console.error("[MCP Rollback] Failed to delete Calendar hold during rollback:", e.message || e);
    }
  }

  if (failedStep >= 2) {
    try {
      console.error(`[MCP Rollback] Deleting SQLite database row for ${bookingCode}`);
      await client.callTool({
        name: "mcp_db_sync_booking",
        arguments: {
          operation: "delete",
          booking_code: bookingCode
        }
      });
    } catch (e: any) {
      console.error("[MCP Rollback] Failed to delete SQLite record during rollback:", e.message || e);
    }
  }
}

/**
 * Executes a sequential reschedule update.
 */
export async function executeRescheduleTransaction(
  bookingCode: string,
  newTopic: string,
  newDate: string,
  newTime: string,
  newStatus: string = 'TENTATIVE'
) {
  const client = await getMcpClient();

  // Fetch original booking first for rollback purposes
  const dbLookupRes = await client.callTool({
    name: "mcp_db_sync_booking",
    arguments: {
      operation: "lookup",
      booking_code: bookingCode
    }
  });

  const content = dbLookupRes.content as any[];
  if (dbLookupRes.isError || !content || !content[0]?.text) {
    throw new Error(`Original booking ${bookingCode} not found in database.`);
  }

  const originalBooking = JSON.parse(content[0].text);
  let step = 0;

  try {
    // 1. SQLite DB Update
    console.error(`[MCP Reschedule] Step 1: Updating SQLite DB for ${bookingCode}`);
    step = 1;
    await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "update",
        booking_code: bookingCode,
        topic: newTopic,
        date: newDate,
        time: newTime,
        status: newStatus
      }
    });

    // 2. Google Calendar Update
    console.error(`[MCP Reschedule] Step 2: Updating Google Calendar Event for ${bookingCode}`);
    step = 2;
    await client.callTool({
      name: "mcp_calendar_update_event",
      arguments: {
        booking_code: bookingCode,
        new_topic: newTopic,
        new_date: newDate,
        new_time: newTime,
        new_status: newStatus
      }
    });

    // 3. Google Sheets Ledger Update
    console.error(`[MCP Reschedule] Step 3: Updating Google Sheets Ledger for ${bookingCode}`);
    step = 3;
    await client.callTool({
      name: "mcp_notes_update_record",
      arguments: {
        booking_code: bookingCode,
        status: newStatus,
        date: newDate,
        time: newTime
      }
    });

    // 4. Gmail Notification Draft Update (Non-blocking)
    console.error(`[MCP Reschedule] Step 4: Updating Gmail Draft for ${bookingCode}`);
    try {
      await client.callTool({
        name: "mcp_email_update_draft",
        arguments: {
          booking_code: bookingCode,
          new_topic: newTopic,
          new_date: newDate,
          new_time: newTime,
          new_status: newStatus
        }
      });
    } catch (emailError: any) {
      console.error("[MCP Reschedule] Gmail draft update failed (non-blocking):", emailError.message || emailError);
    }

    return { success: true };
  } catch (error: any) {
    console.error(`[MCP Reschedule] Failed at step ${step}:`, error.message || error);
    await rollbackReschedule(bookingCode, originalBooking, step);
    throw error;
  }
}

/**
 * Rolls back rescheduling operations.
 */
async function rollbackReschedule(bookingCode: string, original: any, failedStep: number) {
  console.error(`[MCP Reschedule Rollback] Rolling back ${bookingCode} from failed step ${failedStep}`);
  const client = await getMcpClient();

  if (failedStep >= 3) {
    try {
      console.error(`[MCP Reschedule Rollback] Reverting Calendar event for ${bookingCode}`);
      await client.callTool({
        name: "mcp_calendar_update_event",
        arguments: {
          booking_code: bookingCode,
          new_topic: original.topic,
          new_date: original.date,
          new_time: original.time,
          new_status: original.status
        }
      });
    } catch (e: any) {
      console.error("[MCP Reschedule Rollback] Calendar revert failed:", e.message || e);
    }
  }

  if (failedStep >= 2) {
    try {
      console.error(`[MCP Reschedule Rollback] Reverting SQLite DB row for ${bookingCode}`);
      await client.callTool({
        name: "mcp_db_sync_booking",
        arguments: {
          operation: "update",
          booking_code: bookingCode,
          topic: original.topic,
          date: original.date,
          time: original.time,
          status: original.status
        }
      });
    } catch (e: any) {
      console.error("[MCP Reschedule Rollback] SQLite DB revert failed:", e.message || e);
    }
  }
}

/**
 * Executes a sequential cancellation.
 */
export async function executeCancellationTransaction(bookingCode: string) {
  const client = await getMcpClient();

  // Fetch original booking details first
  const dbLookupRes = await client.callTool({
    name: "mcp_db_sync_booking",
    arguments: {
      operation: "lookup",
      booking_code: bookingCode
    }
  });

  const content = dbLookupRes.content as any[];
  if (dbLookupRes.isError || !content || !content[0]?.text) {
    throw new Error(`Booking ${bookingCode} not found in database.`);
  }

  const originalBooking = JSON.parse(content[0].text);

  // 1. SQLite DB Sync (Updates status to 'CANCELLED')
  console.error(`[MCP Cancel] Step 1: Setting status to CANCELLED in DB for ${bookingCode}`);
  await client.callTool({
    name: "mcp_db_sync_booking",
    arguments: {
      operation: "delete", // our soft-delete implementation
      booking_code: bookingCode
    }
  });

  // 2. Google Calendar Event Deletion
  console.error(`[MCP Cancel] Step 2: Deleting Calendar event hold for ${bookingCode}`);
  try {
    await client.callTool({
      name: "mcp_calendar_delete_event",
      arguments: { booking_code: bookingCode }
    });
  } catch (calError: any) {
    console.error("[MCP Cancel] Calendar hold deletion failed:", calError.message || calError);
  }

  // 3. Google Sheets Ledger Update (Updates status to 'CANCELLED')
  console.error(`[MCP Cancel] Step 3: Updating status to CANCELLED in Sheets Ledger for ${bookingCode}`);
  try {
    await client.callTool({
      name: "mcp_notes_update_record",
      arguments: {
        booking_code: bookingCode,
        status: "CANCELLED"
      }
    });
  } catch (notesError: any) {
    console.error("[MCP Cancel] Sheets status update failed:", notesError.message || notesError);
  }

  // 4. Gmail Notification Draft Update (Updates draft to notify of CANCELLED status)
  console.error(`[MCP Cancel] Step 4: Updating Gmail Draft to CANCELLED for ${bookingCode}`);
  try {
    await client.callTool({
      name: "mcp_email_update_draft",
      arguments: {
        booking_code: bookingCode,
        new_topic: originalBooking.topic,
        new_date: originalBooking.date,
        new_time: originalBooking.time,
        new_status: "CANCELLED"
      }
    });
  } catch (emailError: any) {
    console.error("[MCP Cancel] Gmail draft update failed:", emailError.message || emailError);
  }

  return { success: true };
}
