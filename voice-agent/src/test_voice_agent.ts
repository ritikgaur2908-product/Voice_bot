import { handleConversationTurn, SessionState } from './stateMachine.js';
import { getMcpClient } from './mcpClient.js';

async function runSimulation() {
  console.error("Starting Voice Agent FSM Simulation...");

  // Initialize session
  const session: SessionState = {
    sessionId: "sim-sess-123",
    currentState: "GREETING",
    intent: null,
    topic: null,
    preferredDay: null,
    preferredTime: null,
    offeredSlots: [],
    selectedSlot: null,
    bookingCode: null,
    mcpStatus: null,
    turnCount: 0,
    history: []
  };

  const steps = [
    { input: "", desc: "1. Initial Greeting Trigger" },
    { input: "I want to book a consultation please", desc: "2. Book Intent Detection" },
    { input: "KYC / Onboarding", desc: "3. Topic Selection" },
    { input: "tomorrow", desc: "4. Day Collection" },
    { input: "morning", desc: "5. Time Band Collection & Slots Offer" },
    { input: "09:30", desc: "6. Slot Selection" },
    { input: "yes", desc: "7. Confirmation & MCP Execution" }
  ];

  for (const step of steps) {
    console.error(`\n======================================================`);
    console.error(`${step.desc}`);
    console.error(`User says: "${step.input}"`);
    console.error(`======================================================`);

    const { replyText, stateUpdate } = await handleConversationTurn(session, step.input);
    Object.assign(session, stateUpdate);

    console.error(`Agent says: "${replyText}"`);
    console.error(`FSM Current State: ${session.currentState}`);
    console.error(`FSM Variables:`, {
      intent: session.intent,
      topic: session.topic,
      preferredDay: session.preferredDay,
      preferredTime: session.preferredTime,
      offeredSlots: session.offeredSlots,
      selectedSlot: session.selectedSlot,
      bookingCode: session.bookingCode,
      mcpStatus: session.mcpStatus
    });
  }

  console.error("\n======================================================");
  console.error("FSM Simulation Completed Successfully!");
  console.error("======================================================\n");
  
  // Clean up by cancelling the created booking
  if (session.bookingCode) {
    console.error(`Cleaning up: Cancelling simulated booking ${session.bookingCode}...`);
    const mcp = await getMcpClient();
    
    // Cancellation transaction
    await mcp.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "delete",
        booking_code: session.bookingCode
      }
    });
    
    await mcp.callTool({
      name: "mcp_calendar_delete_event",
      arguments: {
        booking_code: session.bookingCode
      }
    });

    console.error("Cleanup complete.");
  }
  
  process.exit(0);
}

runSimulation().catch(err => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
