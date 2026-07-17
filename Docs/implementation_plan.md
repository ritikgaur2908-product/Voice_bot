# Implementation Plan: AI Voice Agent – Advisor Appointment Scheduler

> **Source Documents:** `Docs/architecture.md` · `Docs/context.md`
> **Last Updated:** 2026-07-09

---

## Project Summary

Build a voice-first AI appointment scheduling assistant that:
- Speaks with the user in natural conversation via a web browser
- Uses **Deepgram** for STT, **Gemini** for LLM, **Google Cloud TTS** for voice output
- Stores booking data in **SQLite** via a custom MCP server
- Propagates changes to **Google Calendar**, **Notes/Ledger**, and **Gmail Drafts** via the same MCP server
- Enforces strict compliance (no PII collected during the call)

---

## Architecture at a Glance

```
Browser (React) ──WebSocket──► Voice Agent Backend ──MCP──► Custom MCP Server
                                 (Gemini + FSM)               │
                                                              ├── SQLite DB (Booking Store)
                                                              ├── Google Calendar API
                                                              ├── Notes/Ledger API
                                                              └── Gmail API
```

---

## Phase 1 — Project Setup & Scaffolding

**Goal:** Set up the folder structure, install dependencies, and configure environment variables.

### 1.1 Folder Structure

```
Appointment Scheduler/
├── Docs/
│   ├── architecture.md
│   └── context.md
├── mcp-server/          ← Custom MCP Server (Google APIs + SQLite)
│   ├── src/
│   │   ├── index.ts     ← MCP server entry point
│   │   ├── db.ts        ← SQLite tool handler
│   │   ├── calendar.ts  ← Google Calendar tool handler
│   │   ├── notes.ts     ← Notes/Ledger tool handler
│   │   └── email.ts     ← Gmail Draft tool handler
│   ├── package.json
│   └── .env
├── voice-agent/         ← Voice Agent Backend (Gemini + FSM)
│   ├── src/
│   │   ├── index.ts     ← WebSocket server entry point
│   │   ├── compliance.ts
│   │   ├── stateMachine.ts
│   │   ├── gemini.ts
│   │   └── mcpClient.ts
│   ├── package.json
│   └── .env
└── frontend/            ← React Web Interface
    ├── src/
    │   ├── App.tsx
    │   └── index.css
    └── package.json
```

### 1.2 Dependencies to Install

**`mcp-server/`**
- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — SQLite bindings for Node.js
- `googleapis` — Google Calendar + Gmail APIs
- `dotenv` — environment variable loading
- `typescript`, `tsx`

**`voice-agent/`**
- `@google/genai` — Gemini LLM SDK *(already installed)*
- `@deepgram/sdk` — Deepgram STT streaming
- `@google-cloud/text-to-speech` — Google Cloud TTS
- `ws` — WebSocket server *(already installed)*
- `express` *(already installed)*
- `dotenv` *(already installed)*

**`frontend/`**
- `react`, `react-dom` *(already installed)*
- No additional libraries needed

### 1.3 Environment Variables

**`mcp-server/.env`**
```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-sa.json
SQLITE_DB_PATH=./bookings.db
```

**`voice-agent/.env`**
```
GEMINI_API_KEY=your_gemini_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key
GOOGLE_APPLICATION_CREDENTIALS=./credentials/google-tts-sa.json
MCP_SERVER_URL=http://localhost:3002
```

---

## Phase 2 — Custom MCP Server

**Goal:** Build the single custom MCP server that exposes all 4 backend tools to the voice agent.

### 2.1 SQLite — Booking Store

**Tool:** `mcp_db_sync_booking`

Schema:
```sql
CREATE TABLE bookings (
  booking_code TEXT PRIMARY KEY,
  topic        TEXT NOT NULL,
  date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  timezone     TEXT DEFAULT 'IST',
  status       TEXT DEFAULT 'TENTATIVE',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

Operations:
- `create` — Insert a new booking row
- `update` — Update date/time/status by booking_code
- `delete` — Delete row by booking_code (cancel)
- `lookup` — Fetch row by booking_code (reschedule/cancel flow)

> **No authentication required** — SQLite is a local file

### 2.2 Google Calendar

**Tool:** `mcp_calendar_create_event`

- Event title format: `Advisor Q&A — {Topic} — {Booking Code}`
- Status: `TENTATIVE` or `WAITLIST`
- Auth: Google Service Account credentials (1 setup, shared with Gmail)

Additional tools:
- `mcp_calendar_update_event`
- `mcp_calendar_delete_event`

### 2.3 Notes / Ledger

**Tool:** `mcp_notes_append_record`

- Appends a row to a Google Sheet (or Notion) acting as the `Advisor Pre-Bookings` ledger
- Fields: Date, Time, Topic, Booking Code, Status, Timestamp
- Auth: Same Google Service Account

Additional tools:
- `mcp_notes_update_record`

### 2.4 Gmail Draft

**Tool:** `mcp_email_create_draft`

- Creates a draft in a Gmail inbox (NOT sent automatically)
- `approval_status` field is always `PENDING` on creation
- Auth: Same Google Service Account (with Gmail API scope enabled)

Additional tools:
- `mcp_email_update_draft`

### 2.5 MCP Execution Order (Strictly Sequential)

```
[Booking DB Sync]
      │ fail → abort, inform user
      ▼
[Calendar Hold]
      │ fail → rollback DB sync, inform user
      ▼
[Notes Entry]
      │ fail → rollback Calendar + DB sync, inform user
      ▼
[Email Draft]
      │ fail → log warning only (non-blocking)
      ▼
[Continue to Secure Link]
```

---

## Phase 3 — Voice Agent Backend

**Goal:** Build the backend that manages the conversation, calls Deepgram/Gemini/Google TTS, runs the FSM, and communicates with the MCP server.

### 3.1 Compliance Guard (`compliance.ts`)

Runs on **every** user utterance before any FSM processing:
- **PII detection**: email regex, 9-18 digit number sequences, PAN format
- **Investment advice detection**: keyword matching
- Returns `{ blocked: boolean, reason, message }`

### 3.2 Intent Classifier (`gemini.ts`)

Maps user utterance to one of 5 intents:
| Intent | Description |
|--------|-------------|
| `INTENT_BOOK` | Book new appointment |
| `INTENT_RESCHEDULE` | Reschedule existing booking |
| `INTENT_CANCEL` | Cancel existing booking |
| `INTENT_PREPARE` | Ask about preparation |
| `INTENT_AVAILABILITY` | Check available slots |

### 3.3 Conversation State Machine / FSM (`stateMachine.ts`)

States and transitions:
```
GREETING → DISCLAIMER → INTENT_DETECTION
  ├── INTENT_BOOK → TOPIC_COLLECTION → DAY_COLLECTION → TIME_COLLECTION
  │       → SLOT_SEARCH → SLOT_OFFER → SLOT_SELECTION
  │       → CONFIRMATION → CODE_GENERATION → MCP_EXECUTION → SECURE_LINK → END
  ├── INTENT_RESCHEDULE → RESCHEDULE_CODE → DAY_COLLECTION → ... → MCP_EXECUTION → END
  ├── INTENT_CANCEL → CANCEL_CODE → MCP_EXECUTION → END
  ├── INTENT_PREPARE → PREPARATION_INFO → END
  └── INTENT_AVAILABILITY → AVAILABILITY_INFO → END
```

Session state payload persisted per conversation turn:
```json
{
  "session_id", "current_state", "intent", "topic",
  "preferred_day", "preferred_time", "offered_slots",
  "selected_slot", "booking_code", "mcp_status", "turn_count"
}
```

### 3.4 Slot Engine (`stateMachine.ts`)

- Input: preferred day + time (natural language)
- Output: exactly 2 available slots (or empty → Waitlist flow)
- Day resolution: `tomorrow`, `Monday`, `2026-07-10` → absolute date
- Time band mapping: `morning` → 09:00-12:00, `afternoon` → 12:00-17:00, `evening` → 17:00-20:00

### 3.5 Booking Code Generator (`stateMachine.ts`)

- Format: `AA-XXXX` (2 random letters + 4 alphanumeric)
- Checks uniqueness against SQLite DB before finalizing
- Max 5 retries on collision

### 3.6 Audio Pipeline (`index.ts`)

```
User speaks → Browser (MediaRecorder) → WebSocket → Voice Agent
  → Deepgram SDK (STT) → Text transcript
  → Compliance Guard → Intent Classifier → FSM → Gemini response
  → Google Cloud TTS → Audio bytes → WebSocket → Browser plays audio
```

### 3.7 MCP Client (`mcpClient.ts`)

- Connects to the custom MCP server running on `http://localhost:3002`
- Calls tools in sequential order with rollback on failure
- Logs every MCP call with full payload for audit

---

## Phase 4 — React Frontend (Web Interface)

**Goal:** Build a premium-looking, real-time voice interface for the user.

### 4.1 Core UI Components

- **Call Panel**: Mic start/stop button, connection status indicator
- **Audio Waveform Visualizer**: Real-time microphone activity animation
- **Conversation Transcript**: Scrolling chat-style transcript of the dialogue
- **FSM State Visualizer**: Shows which step in the conversation the agent is at (e.g., `SLOT_OFFER`)
- **Booking DB Inspector**: Live view of the SQLite table for demo purposes
- **Secure Link Panel**: Appears at the end of booking with the secure URL

### 4.2 WebSocket Communication

```
Frontend → backend:
  { type: "audio_chunk", data: <ArrayBuffer> }

Backend → frontend:
  { type: "transcript", text: "...", speaker: "user" | "agent" }
  { type: "state_update", state: "SLOT_OFFER", session: { ... } }
  { type: "audio_response", data: <ArrayBuffer> }
  { type: "booking_complete", code: "AA-4837", link: "https://..." }
```

### 4.3 Design Aesthetic

- **Dark glassmorphism** theme with soft gradient backgrounds
- **Animated mic button** with pulse ring while listening
- **Smooth state transition** animations between conversation phases

---

## Phase 5 — Integration & End-to-End Testing

**Goal:** Run all three components together and verify every conversation flow works.

### 5.1 Happy Path — Book Appointment
1. Start call → Greeting & Disclaimer
2. Say: "I want to book an appointment"
3. Select topic → preferred day → preferred time
4. Choose one of 2 offered slots
5. Confirm → Booking code generated
6. MCP fires: DB sync → Calendar hold → Notes entry → Email draft
7. Secure link read aloud

### 5.2 Reschedule Flow
1. Say: "I want to reschedule"
2. Provide booking code
3. Select new slot → Confirm
4. MCP fires: DB update → Calendar update → Notes update → Email update

### 5.3 Cancel Flow
1. Say: "Cancel my appointment"
2. Provide booking code
3. Confirm → MCP fires: DB delete → Calendar delete → Notes update → Email update

### 5.4 Waitlist Flow
1. Select Sunday (no slots available)
2. Agent offers waitlist
3. MCP fires: DB sync (WAITLISTED) → Calendar waitlist hold → Notes waitlist entry → Email draft (Notify Advisor)

### 5.5 Compliance Tests
- Volunteer a phone number mid-call → Agent interrupts politely
- Ask for investment advice → Agent refuses and redirects
- Provide PAN format → Agent intercepts

---

## Phase 6 — API Keys & Final Credentials Setup

**Goal:** Replace mock data with real API credentials and verify live calls.

### 6.1 Required Credentials

| Service | Where to get it | Purpose |
|---------|----------------|---------|
| Gemini API Key | [aistudio.google.com](https://aistudio.google.com) | LLM Orchestration |
| Deepgram API Key | [console.deepgram.com](https://console.deepgram.com) | Speech-to-Text |
| Google Service Account JSON | Google Cloud Console | Calendar + Gmail + TTS |
| SQLite DB Path | Local file path | No login needed |

### 6.2 Google Service Account Scopes Needed

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/cloud-platform (for TTS)
```

---

## Phase Summary

| Phase | Component | Key Output |
|-------|-----------|------------|
| **Phase 1** | Project Setup | Folder structure, `.env` files, dependencies installed |
| **Phase 2** | MCP Server | 4 tools working: SQLite, Calendar, Notes, Gmail |
| **Phase 3** | Voice Agent Backend | Full FSM, Compliance Guard, Deepgram STT, Google TTS |
| **Phase 4** | React Frontend | Premium voice UI with live visualizers |
| **Phase 5** | Integration Testing | All 5 flows verified end-to-end |
| **Phase 6** | Credentials Setup | Real API keys wired in, live demo ready |
