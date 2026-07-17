import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@deepgram/sdk';
import { checkCompliance } from './compliance.js';
import { handleConversationTurn, SessionState } from './stateMachine.js';
import { getMcpClient } from './mcpClient.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Express Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', component: 'voice-agent-backend' });
});

// Bookings Database Inspector API for Frontend
app.get('/bookings', async (req, res) => {
  try {
    const client = await getMcpClient();
    const dbRes = await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: { operation: "list" }
    });
    const content = dbRes.content as any[];
    const bookings = dbRes.isError || !content || !content[0]?.text
      ? []
      : JSON.parse(content[0].text);
    res.json(bookings);
  } catch (err: any) {
    console.error("[API] Failed to fetch bookings:", err.message || err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// API to confirm booking, update SQLite status, and push to Google Calendar/Sheets/Gmail
app.post('/confirm-booking', async (req, res) => {
  const { bookingCode, name, email, phone, notes } = req.body;
  if (!bookingCode || !name || !email) {
    return res.status(400).json({ error: "Missing required fields (bookingCode, name, email)" });
  }

  try {
    const client = await getMcpClient();
    
    // 1. Look up existing booking in SQLite
    const lookupRes = await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "lookup",
        booking_code: bookingCode
      }
    });
    
    const lookupContent = lookupRes.content as any[];
    if (lookupRes.isError || !lookupContent || !lookupContent[0]?.text || lookupContent[0].text === "null") {
      return res.status(404).json({ error: `Booking code ${bookingCode} not found` });
    }
    
    const bookingDetails = JSON.parse(lookupContent[0].text);

    // 2. SQLite Update
    await client.callTool({
      name: "mcp_db_sync_booking",
      arguments: {
        operation: "update",
        booking_code: bookingCode,
        status: "CONFIRMED"
      }
    });

    // 3. Google Calendar Update
    try {
      await client.callTool({
        name: "mcp_calendar_update_event",
        arguments: {
          booking_code: bookingCode,
          new_topic: bookingDetails.topic,
          new_date: bookingDetails.date,
          new_time: bookingDetails.time,
          new_status: "CONFIRMED"
        }
      });
    } catch (e: any) {
      console.error("[Confirm Booking] Calendar update failed:", e.message || e);
    }

    // 4. Google Sheets Update
    try {
      await client.callTool({
        name: "mcp_notes_update_record",
        arguments: {
          booking_code: bookingCode,
          status: "CONFIRMED",
          name,
          email,
          phone,
          notes
        }
      });
    } catch (e: any) {
      console.error("[Confirm Booking] Sheets update failed:", e.message || e);
    }

    // 5. Gmail Notification Draft
    try {
      await client.callTool({
        name: "mcp_email_update_draft",
        arguments: {
          booking_code: bookingCode,
          new_topic: bookingDetails.topic,
          new_date: bookingDetails.date,
          new_time: bookingDetails.time,
          new_status: "CONFIRMED",
          name,
          email,
          phone,
          notes
        }
      });
    } catch (e: any) {
      console.error("[Confirm Booking] Gmail draft update failed:", e.message || e);
    }

    res.json({ success: true, bookingCode });
  } catch (err: any) {
    console.error("[Confirm Booking Error]", err);
    res.status(500).json({ error: err.message || "Failed to confirm booking" });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Deepgram client
const deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';
const deepgram = deepgramApiKey ? createClient(deepgramApiKey) : null;

if (!deepgram) {
  console.warn("[Deepgram] DEEPGRAM_API_KEY missing. Audio streaming and TTS will run in fallback/mock mode.");
}

/**
 * Synthesizes text response into audio bytes (MP3) using Deepgram Aura TTS
 */
async function readableStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Cleans text for TTS synthesis (strips markdown formatting and spells out acronyms)
 */
function cleanTextForTts(text: string): string {
  // Remove markdown bold (**word**), italics (*word* or _word_)
  let cleaned = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1');

  // Remove header hashes (#)
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // Remove bullet point characters at start of lines
  cleaned = cleaned.replace(/^[-*]\s+/gm, '');

  // Spell out financial/technical acronyms so TTS pronounces individual letters
  const acronyms: { [key: string]: string } = {
    "kyc": "K Y C",
    "sip": "S I P",
    "ist": "I S T",
    "pii": "P I I",
    "mcp": "M C P",
    "fsm": "F S M",
    "tts": "T T S",
    "stt": "S T T",
    "pan": "P A N",
    "uidai": "U I D A I",
    "ssn": "S S N"
  };

  for (const [key, replacement] of Object.entries(acronyms)) {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    cleaned = cleaned.replace(regex, replacement);
  }

  // Convert YYYY-MM-DD (e.g. 2026-07-13) into natural conversational spoken text (e.g. "July thirteenth, twenty twenty-six")
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const ordinals = [
    "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth",
    "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first"
  ];

  cleaned = cleaned.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match, y, m, d) => {
    const monthIndex = parseInt(m, 10) - 1;
    const dayIndex = parseInt(d, 10);
    const monthName = months[monthIndex] || m;
    const dayOrdinal = ordinals[dayIndex] || d;
    return `${monthName} ${dayOrdinal}, twenty twenty-six`;
  });

  // Remove extra whitespaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Synthesizes text response into audio bytes (MP3) using Deepgram Aura TTS
 */
async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!deepgram) return null;
  try {
    const cleanedText = cleanTextForTts(text);
    console.error(`[Deepgram TTS Input] Cleaned: "${cleanedText}"`);
    const response = await deepgram.speak.request(
      { text: cleanedText },
      { model: "aura-asteria-en" }
    );
    const stream = await response.getStream();
    if (!stream) {
      throw new Error("Empty stream returned from Deepgram TTS");
    }
    const buffer = await readableStreamToBuffer(stream);
    return buffer.toString('base64');
  } catch (error) {
    console.error("[Deepgram TTS] Speech synthesis error:", error);
    return null;
  }
}

// WebSocket Connection Handler
wss.on('connection', async (ws: WebSocket) => {
  console.error("[WebSocket] Client connected.");

  // Initialize Session State
  const session: SessionState = {
    sessionId: Math.random().toString(36).substring(2, 11),
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

  // Audio chunk queue to prevent dropping initial WebM header before Deepgram WS opens
  const audioBufferQueue: Buffer[] = [];
  let isDgReady = false;
  let audioChunkCount = 0;

  // Setup Deepgram Live connection if available
  let dgConnection: any = null;

  if (deepgram) {
    try {
      dgConnection = deepgram.listen.live({
        model: "nova-2",
        language: "en-US",
        smart_format: true,
        interim_results: true,
        utterance_end_ms: 1500,  // Financial-grade: 1500ms silence = end of turn
        vad_events: true,
        endpointing: 500,         // 500ms endpointing for more deliberate speech
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
      });

      dgConnection.on("open", () => {
        console.error("[Deepgram] Live connection opened. Flushing buffered chunks:", audioBufferQueue.length);
        isDgReady = true;
        while (audioBufferQueue.length > 0) {
          const chunk = audioBufferQueue.shift();
          if (chunk) dgConnection.send(chunk);
        }
      });

      // CRITICAL: In Deepgram SDK v3, the transcript event is called "Results" not "transcript"
      dgConnection.on("Results", async (data: any) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          // Send barge-in on actual spoken words so acoustic echo from laptop speakers during TTS playback does not cut off the assistant right after the first word!
          if (transcript.trim().length >= 2) {
            ws.send(JSON.stringify({ type: "barge_in" }));
          }

          if (data.is_final || data.speech_final) {
            console.error(`[Deepgram STT Final] Transcript: "${transcript}"`);
            ws.send(JSON.stringify({ type: "transcript", text: transcript, speaker: "user" }));
            await processUtterance(transcript);
          } else {
            console.error(`[Deepgram STT Interim] Transcript: "${transcript}"`);
            ws.send(JSON.stringify({ type: "transcript_interim", text: transcript, speaker: "user" }));
          }
        }
      });

      dgConnection.on("SpeechStarted", () => {
        console.error("[Deepgram] Speech started detected (VAD).");
        // Note: Do not trigger raw barge_in on acoustic VAD alone because laptop speakers playing TTS audio trigger VAD immediately after "Welcome"!
      });

      dgConnection.on("UtteranceEnd", () => {
        console.error("[Deepgram] Utterance end detected.");
      });

      dgConnection.on("error", (err: any) => {
        console.error("[Deepgram] Live error:", err);
      });

      dgConnection.on("close", (e: any) => {
        console.error("[Deepgram] Live connection closed:", e?.code, e?.reason);
      });

      dgConnection.on("warning", (w: any) => {
        console.error("[Deepgram] Live warning:", w);
      });

      dgConnection.on("Unhandled", (u: any) => {
        console.error("[Deepgram] Unhandled event:", JSON.stringify(u));
      });
    } catch (dgError) {
      console.error("[Deepgram] Failed to establish live connection:", dgError);
    }
  }

  // Initial greeting trigger
  await triggerGreeting();

  // Helper to trigger initial greeting
  async function triggerGreeting() {
    // Wait 150ms to allow immediate client messages (like quick chat chips) to arrive first
    await new Promise(resolve => setTimeout(resolve, 150));
    if (session.turnCount > 0 || session.currentState !== "GREETING") {
      console.error("[FSM] Client sent immediate message, skipping initial GREETING audio.");
      return;
    }

    console.error("[FSM] Triggering GREETING state...");
    const { replyText, stateUpdate } = await handleConversationTurn(session, "");
    Object.assign(session, stateUpdate);

    const base64Audio = await synthesizeSpeech(replyText);
    
    ws.send(JSON.stringify({ 
      type: "transcript", 
      text: replyText, 
      speaker: "agent" 
    }));
    
    ws.send(JSON.stringify({ 
      type: "state_update", 
      state: session.currentState, 
      session 
    }));

    if (base64Audio) {
      ws.send(JSON.stringify({ type: "audio_response", data: base64Audio }));
    }
  }

  // Core Dialogue processing function
  async function processUtterance(text: string) {
    // 1. Compliance Guard Check
    const compliance = checkCompliance(text);
    if (compliance.blocked) {
      console.error(`[Compliance Block] Reason: ${compliance.reason}, Message: ${compliance.redirectMessage}`);
      
      ws.send(JSON.stringify({ 
        type: "transcript", 
        text: compliance.redirectMessage, 
        speaker: "agent",
        complianceBlocked: true
      }));

      const base64Audio = await synthesizeSpeech(compliance.redirectMessage || "");
      if (base64Audio) {
        ws.send(JSON.stringify({ type: "audio_response", data: base64Audio }));
      }
      return; // Do NOT advance state machine
    }

    // 2. FSM Processing
    try {
      const { replyText, stateUpdate } = await handleConversationTurn(session, text);
      Object.assign(session, stateUpdate);

      // Synthesize agent response to audio
      const base64Audio = await synthesizeSpeech(replyText);

      ws.send(JSON.stringify({ 
        type: "transcript", 
        text: replyText, 
        speaker: "agent" 
      }));

      ws.send(JSON.stringify({ 
        type: "state_update", 
        state: session.currentState, 
        session 
      }));

      if (base64Audio) {
        ws.send(JSON.stringify({ type: "audio_response", data: base64Audio }));
      }

      // Check if conversation complete or ready for verification
      if (session.currentState === "END" || session.currentState === "MCP_EXECUTION" || session.currentState === "CANCEL_CONFIRMATION" || session.currentState === "WAITLIST_CONFIRMATION") {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        ws.send(JSON.stringify({
          type: "booking_complete",
          code: session.bookingCode,
          link: `${frontendUrl}/?code=${session.bookingCode}`
        }));
      }

    } catch (err: any) {
      console.error("[FSM Error] Failed to process conversation turn:", err);
      ws.send(JSON.stringify({ 
        type: "transcript", 
        text: "I encountered a system error. Let's try that step again.", 
        speaker: "agent" 
      }));
    }
  }

  // Handle client messages (audio chunks or text fallbacks)
  ws.on('message', async (message: Buffer) => {
    try {
      // Try to parse as JSON first (for text inputs)
      const dataString = message.toString();
      try {
        const payload = JSON.parse(dataString);
        if (payload.type === "text_message" && payload.text) {
          console.error(`[WebSocket Text] Received text: "${payload.text}"`);
          await processUtterance(payload.text);
          return;
        }
      } catch {
        // Not a JSON message, treat as raw binary audio chunk
      }

      if (audioChunkCount++ < 5) {
        console.error(`[WebSocket Audio] Received PCM chunk #${audioChunkCount} of size ${message.length} bytes.`);
      }

      // Feed raw PCM16 audio to Deepgram or buffer if still connecting
      if (dgConnection) {
        if (isDgReady && dgConnection.getReadyState() === 1) {
          dgConnection.send(message);
        } else {
          audioBufferQueue.push(message);
        }
      }
    } catch (err) {
      console.error("[WebSocket message error]", err);
    }
  });

  ws.on('close', () => {
    console.error("[WebSocket] Client disconnected.");
    if (dgConnection) {
      dgConnection.finish();
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.error(`Voice Agent Backend successfully started on port ${PORT}!`);
});
