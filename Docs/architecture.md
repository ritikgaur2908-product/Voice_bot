# System Architecture

> **Project:** AI Voice Agent – Advisor Appointment Scheduler
> **Source:** Derived from [`context.md`](./context.md)
> **Last Updated:** 2026-07-05

---

## 1. Architecture Overview

The system follows a **layered, event-driven architecture** built around a voice-first AI agent that orchestrates scheduling workflows through the Model Context Protocol (MCP). All intelligence lives in the AI layer; all persistence happens through MCP tool calls; no PII ever passes through the voice channel.

```
+---------------------------------------------------------------+
|                        USER (Caller)                          |
+---------------------------+-----------------------------------+
                            | Voice / Audio
+---------------------------v-----------------------------------+
|               VOICE INTERFACE LAYER                           |
|   Speech-to-Text (STT)         Text-to-Speech (TTS)          |
+---------------------------+-----------------------------------+
                            | Transcript text
+---------------------------v-----------------------------------+
|              AI ORCHESTRATION LAYER                           |
|                                                               |
|  +-------------------+   +-----------------------------+     |
|  | Compliance Guard  |   |   Intent Classifier         |     |
|  | (PII / Advice     |   |   (5 intents)               |     |
|  |  Interceptor)     |   +-----------------------------+     |
|  +-------------------+                                        |
|                                                               |
|  +----------------------------------------------------------+ |
|  |           Conversation State Manager (FSM)               | |
|  |  Greeting -> Disclaimer -> Intent -> Topic -> Day ->     | |
|  |  Time -> Slots -> Confirm -> Code -> MCP -> Link -> End  | |
|  +----------------------------------------------------------+ |
|                                                               |
|  +-------------------+   +-----------------------------+     |
|  | Slot Engine       |   |   Booking Code Generator    |     |
|  | (Mock Calendar)   |   |   (AA-XXXX format)          |     |
|  +-------------------+   +-----------------------------+     |
+---------------------------+-----------------------------------+
                            | MCP Tool Calls
+---------------------------v-----------------------------------+
|                  MCP INTEGRATION LAYER                        |
|                                                               |
|   +--------------+  +------------+  +------------+  +---------+   |
|   | MCP Calendar |  | MCP Notes  |  | MCP Email  |  | MCP DB  |   |
|   | (Holds)      |  | (Ledger)   |  | (Drafts)   |  | (Bookings)|  |
|   +--------------+  +------------+  +------------+  +---------+   |
|                                                               |
+---------------------------+-----------------------------------+
                            | Data
+---------------------------v-----------------------------------+
|                    DATA / STORAGE LAYER                       |
|  Calendar Store  |  Notes Ledger  |  Email Drafts  | Booking DB |
+---------------------------------------------------------------+
                            |
              Secure Link -> https://example.com/complete-booking
              (User submits PII here - outside this system)
```

---

## 2. Layer-by-Layer Breakdown

### 2.1 Voice Interface Layer

Handles all audio I/O. Decoupled from the AI so the STT/TTS provider can be swapped independently.

| Sub-Component | Responsibility |
|---------------|---------------|
| **STT Engine** | Converts caller audio to text transcript in real time |
| **TTS Engine** | Converts agent text responses back to natural speech |
| **Audio Stream Manager** | Manages duplex audio streams, detects silence, handles interruptions |
| **Noise / Clarity Filter** | Pre-processes audio for better transcription accuracy |

**Key design decision:** Interruption support is handled here — when the caller speaks over the agent, the audio stream triggers a mid-turn cancellation signal that bubbles up to the State Manager.

---

### 2.2 AI Orchestration Layer

The brain of the system. Composed of five focused modules that work together to produce the correct next agent action.

#### 2.2.1 Compliance Guard (Interceptor)

Runs on **every** user utterance before any other processing. Acts as a pre-processing filter.

```
User Utterance
      |
      v
+----------------------+
| PII Detector         |  -- regex + NLP scan for: name, phone, email,
|                      |     PAN, Aadhaar, account no., OTP, password, DOB
+----------+-----------+
           |
    PII Detected?
     Yes |       No
         |        |
+--------v---+    |
| Interrupt  |    |
| Politely   |    v
| + Continue | Advice Detector
+------------+    |
             Advice Requested?
              Yes |       No
                  |        |
         +--------v---+    v
         | Refuse     | Pass to Intent Classifier
         | Politely   |
         +------------+
```

**Blocked data types:**
Name, Phone Number, Email, PAN, Aadhaar, Account Number, Customer ID, Address, Date of Birth, Bank Details, OTP, Password

---

#### 2.2.2 Intent Classifier

Maps natural language input to one of 5 canonical intents using semantic matching.

| Intent ID | Intent Name | Trigger Keywords / Semantics |
|-----------|-------------|------------------------------|
| `INTENT_BOOK` | Book Appointment | schedule, book, consult, meet, appointment, advisor |
| `INTENT_RESCHEDULE` | Reschedule | change, move, reschedule, different time, shift |
| `INTENT_CANCEL` | Cancel | cancel, drop, remove, no longer, don't need |
| `INTENT_PREPARE` | Check Preparation | prepare, documents, ready, bring, what do I need |
| `INTENT_AVAILABILITY` | Check Availability | available, slots, when, next opening, free time |

**Fallback:** If confidence is below threshold, the agent politely asks for clarification with a re-prompt. Maximum 2 re-prompts before offering a menu of options.

---

#### 2.2.3 Conversation State Manager (Finite State Machine)

The central controller. Maintains the full session state and drives the conversation forward step by step.

```
[START]
   |
   v
[GREETING] --------> speaks welcome message
   |
   v
[DISCLAIMER] ------> speaks compliance disclaimer (mandatory, blocking)
   |
   v
[INTENT_DETECTION] --> routes based on detected intent
   |
   +---> INTENT_BOOK ---------> [TOPIC_COLLECTION]
   |                                    |
   +---> INTENT_RESCHEDULE ---> [RESCHEDULE_FLOW]
   |                                    |
   +---> INTENT_CANCEL -------> [CANCEL_FLOW]
   |                                    |
   +---> INTENT_PREPARE ------> [PREPARATION_INFO] -> [END]
   |                                    |
   +---> INTENT_AVAILABILITY -> [AVAILABILITY_INFO] -> [END]

[TOPIC_COLLECTION]
   | - presents 5 topics
   | - maps fuzzy input to nearest topic
   v
[DAY_COLLECTION]
   | - collects preferred day (e.g., "tomorrow", "Monday")
   v
[TIME_COLLECTION]
   | - collects preferred time (e.g., "afternoon", "2 PM")
   v
[SLOT_SEARCH]
   | - calls Slot Engine with (day, time)
   | - if no slots found -> [WAITLIST_FLOW]
   v
[SLOT_OFFER]
   | - presents exactly 2 available slots
   v
[SLOT_SELECTION]
   | - user picks one
   v
[CONFIRMATION]
   | - repeats: topic, date, time, IST timezone
   | - asks "Should I confirm?"
   v
[CODE_GENERATION]
   | - generates unique booking code (AA-XXXX)
   v
[MCP_EXECUTION] -----> triggers all 3 MCP actions in sequence
   |
   v
[SECURE_LINK]
   | - reads booking code aloud
   | - provides https://example.com/complete-booking
   v
[END]
```

**State payload (persisted per turn):**

```json
{
  "session_id": "string",
  "current_state": "SLOT_OFFER",
  "intent": "INTENT_BOOK",
  "topic": "SIP / Mandates",
  "preferred_day": "Tuesday",
  "preferred_time": "afternoon",
  "offered_slots": ["2:00 PM IST", "4:30 PM IST"],
  "selected_slot": "2:00 PM IST",
  "booking_code": "AA-4837",
  "mcp_status": {
    "calendar": "done",
    "notes": "done",
    "email_draft": "done"
  },
  "turn_count": 7,
  "created_at": "2026-07-05T14:30:00Z"
}
```

---

#### 2.2.4 Slot Engine (Mock Calendar Service)

Simulates a real calendar to return available appointment windows.

**Interface:**
```
Input:
  - preferred_day: string   (e.g., "tomorrow", "Monday", "2026-07-08")
  - preferred_time: string  (e.g., "morning", "2 PM", "afternoon")

Output:
  - slots: [SlotObject, SlotObject]   (always exactly 2)
  - OR: empty []  -> triggers Waitlist Flow
```

**Slot resolution logic:**
```
"tomorrow afternoon"
        |
        v
  Day Resolver -> resolves to absolute date (e.g., 2026-07-06)
        |
        v
  Time Band Mapper:
    morning   -> 09:00 - 12:00
    afternoon -> 12:00 - 17:00
    evening   -> 17:00 - 20:00
    specific  -> +/- 90 min window around stated time
        |
        v
  Calendar Store Query -> returns free slots in window
        |
        v
  Pick 2 slots, spread at least 1 hour apart
        |
        v
  Return formatted: "Tuesday, 2:00 PM IST" + "Tuesday, 4:30 PM IST"
```

---

#### 2.2.5 Booking Code Generator

Generates a unique, collision-resistant, human-readable reference code.

```
Format: [2 uppercase letters] - [4 alphanumeric chars]
Examples: AA-4837, NL-A742, KY-3B91

Algorithm:
  1. Generate random 2-char letter prefix
  2. Generate random 4-char alphanumeric suffix (uppercase)
  3. Check uniqueness against existing codes in Notes Store
  4. If collision, regenerate (max 5 retries)
  5. Return code
```

---

### 2.3 MCP Integration Layer

All backend state mutations happen exclusively through MCP tool calls. The AI layer never writes directly to storage.

#### MCP Action 1 — Booking Store DB Sync

```
Tool: mcp_db_sync_booking
Trigger: After user confirms booking

Payload:
{
  "booking_code": "AA-4837",
  "topic": "SIP / Mandates",
  "date": "2026-07-08",
  "time": "14:00",
  "timezone": "IST",
  "status": "TENTATIVE"
}

On Reschedule: mcp_db_sync_booking (booking_code, updated slot details, status: RESCHEDULED)
On Cancel:     mcp_db_sync_booking (booking_code, status: CANCELLED)
On Waitlist:   mcp_db_sync_booking (booking_code, status: WAITLISTED)
```

#### MCP Action 2 — Calendar Hold

```
Tool: mcp_calendar_create_event
Trigger: After Booking DB sync succeeds

Payload:
{
  "title": "Advisor Q&A — {Topic} — {Booking Code}",
  "date": "2026-07-08",
  "time": "14:00",
  "timezone": "IST",
  "status": "TENTATIVE",
  "booking_code": "AA-4837",
  "topic": "SIP / Mandates"
}

On Reschedule: mcp_calendar_update_event (same booking_code, new date/time)
On Cancel:     mcp_calendar_delete_event (booking_code)
On Waitlist:   mcp_calendar_create_event (status: "WAITLIST")
```

#### MCP Action 3 — Notes Entry

```
Tool: mcp_notes_append_record
Target: "Advisor Pre-Bookings" ledger
Trigger: After calendar hold succeeds

Payload:
{
  "booking_code": "AA-4837",
  "topic": "SIP / Mandates",
  "date": "2026-07-08",
  "time": "14:00 IST",
  "status": "TENTATIVE",
  "timestamp": "2026-07-05T14:30:00Z"
}

On Reschedule: mcp_notes_update_record (booking_code, new date/time, status: RESCHEDULED)
On Cancel:     mcp_notes_update_record (booking_code, status: CANCELLED)
On Waitlist:   mcp_notes_append_record (status: WAITLISTED)
```

#### MCP Action 4 — Draft Email

```
Tool: mcp_email_create_draft
Trigger: After notes entry succeeds
Approval: NEVER auto-sent — requires human approval

Payload:
{
  "subject": "Advisor Q&A — AA-4837 — SIP / Mandates — 2026-07-08 14:00 IST",
  "body": "A tentative advisor appointment has been pre-booked...",
  "approval_status": "PENDING",
  "booking_code": "AA-4837"
}

On Reschedule: mcp_email_update_draft (booking_code, updated slot details)
On Cancel:     mcp_email_update_draft (booking_code, status: CANCELLED)
On Waitlist:   mcp_email_create_draft (subject: "Waitlist Request — ...")
```

**MCP Execution Order (strictly sequential, fail-safe):**

```
[Booking DB Sync]
      |
   success?
   Yes |  No -> abort operation, inform user
      v
[Calendar Hold]
      |
   success?
   Yes |  No -> rollback Booking DB entry, inform user, offer retry
      v
[Notes Entry]
      |
   success?
   Yes |  No -> rollback Calendar hold & Booking DB entry, inform user
      v
[Email Draft]
      |
   success?
   Yes |  No -> log warning (non-blocking, DB + Calendar + Notes already written)
      v
[Continue to Secure Link]
```

---

### 2.4 Data / Storage Layer

Four logical data stores, each accessed exclusively via MCP tools:

#### Booking Store (Source of Truth)

| Field | Type | Notes |
|-------|------|-------|
| `booking_code` | string (PK) | Unique, e.g. AA-4837 |
| `topic` | enum | One of 5 predefined topics |
| `date` | date | ISO 8601 |
| `time` | time | HH:MM |
| `timezone` | string | Always "IST" |
| `status` | enum | TENTATIVE, CONFIRMED, RESCHEDULED, CANCELLED, WAITLISTED |
| `created_at` | datetime | UTC |
| `updated_at` | datetime | UTC |

#### Notes Ledger (`Advisor Pre-Bookings`)

| Field | Type |
|-------|------|
| `booking_code` | string (FK) |
| `topic` | string |
| `appointment_slot` | string (human-readable) |
| `status` | string |
| `timestamp` | datetime |

#### Calendar Event Store

| Field | Type |
|-------|------|
| `event_id` | string |
| `title` | string |
| `date` | date |
| `time` | time |
| `status` | enum (TENTATIVE / WAITLIST / CANCELLED) |
| `booking_code` | string (FK) |

#### Email Draft Store

| Field | Type |
|-------|------|
| `draft_id` | string |
| `subject` | string |
| `body` | text |
| `approval_status` | enum (PENDING / APPROVED / REJECTED) |
| `booking_code` | string (FK) |

---

## 3. Special Flow Architectures

### 3.1 Rescheduling Flow

```
[INTENT_RESCHEDULE detected]
        |
        v
[Ask for Booking Code]
        |
        v
[Lookup in Notes Ledger]
        |
   Found?
   Yes |   No -> "Code not found. Want to book a new appointment?"
        |
        v
[Read back current appointment]
        |
        v
[Collect new day + time preferences]
        |
        v
[Slot Engine] -> 2 new slots
        |
        v
[User selects slot + Confirmation]
        |
        v
[MCP: Update Calendar + Notes + Email Draft]
        |
        v
[Read updated booking back to user] -> [END]
```

### 3.2 Cancellation Flow

```
[INTENT_CANCEL detected]
        |
        v
[Ask for Booking Code]
        |
   Found?
   Yes |   No -> inform user, offer to book new
        |
        v
[MCP: Cancel Calendar Hold]
[MCP: Update Notes (status: CANCELLED)]
[MCP: Update Email Draft (status: CANCELLED)]
        |
        v
[Read cancellation confirmation aloud] -> [END]
```

### 3.3 Waitlist Flow

```
[Slot Engine returns empty result]
        |
        v
[Inform user: no slots match preference]
        |
        v
[Generate Waitlist Booking Code]
        |
        v
[MCP: Calendar Waitlist Hold]
[MCP: Notes Waitlist Entry]
[MCP: Draft "Notify Advisor" Email]
        |
        v
[Inform user: team will review and contact via secure link]
        |
        v
[Provide Secure Link] -> [END]
```

---

## 4. Compliance Architecture

Compliance is enforced at **three independent layers** to prevent bypass:

```
Layer 1 — Pre-Processing (Compliance Guard)
  - Runs before Intent Classifier on every turn
  - PII regex + NLP detection
  - Investment advice keyword matching
  - Immediate interrupt if triggered

Layer 2 — State Machine (Hard Constraints)
  - Only allowed data fields per state are collected
  - Booking flows never request: name, phone, email, account number
  - Rescheduling / Cancellation flows accept booking_code only

Layer 3 — MCP Payload Validation
  - MCP tool schemas enforce allowed fields
  - No PII fields present in any MCP payload schema
  - All payloads logged for audit
```

**Compliance state machine constraint table:**

| State | Allowed Inputs |
|-------|---------------|
| GREETING | Any (no data collected) |
| DISCLAIMER | Acknowledgement only |
| INTENT_DETECTION | Free speech (compliance-guarded) |
| TOPIC_COLLECTION | Topic selection only |
| DAY_COLLECTION | Day / date only |
| TIME_COLLECTION | Time preference only |
| SLOT_SELECTION | Slot number (1 or 2) |
| CONFIRMATION | Yes / No |
| RESCHEDULE_CODE | Booking code only |
| CANCEL_CODE | Booking code only |

---

## 5. Error Handling Architecture

Every error path has a defined recovery strategy:

| Error | Detection Point | Recovery Strategy |
|-------|----------------|-------------------|
| Unclear speech / low ASR confidence | Voice Interface Layer | Re-prompt (max 2x), then offer menu |
| Unsupported topic | Topic Collector | Semantic fuzzy match, then re-prompt |
| Invalid date | Day Collector | Ask for specific date, offer examples |
| Invalid time | Time Collector | Ask for time in HH:MM or common phrase |
| Booking code not found | Reschedule / Cancel FSM | Inform user, offer to book new appointment |
| MCP Calendar failure | MCP Layer | Retry once, then trigger waitlist, log error |
| MCP Notes failure | MCP Layer | Rollback calendar hold, inform user, log |
| MCP Email Draft failure | MCP Layer | Non-blocking warning, log, continue to link |
| Calendar unavailable | Slot Engine | Auto-trigger waitlist flow |
| Duplicate booking code | Code Generator | Regenerate (up to 5 retries) |
| User changes mind mid-flow | State Manager | "Back" command returns to previous state |
| User interrupts TTS | Audio Stream Manager | Cancel TTS, re-enter listen mode |

---

## 6. Session & Logging Architecture

### Session Management

Each call gets a unique session:

```json
{
  "session_id": "uuid-v4",
  "call_start": "2026-07-05T14:30:00Z",
  "call_end": null,
  "state_history": ["GREETING", "DISCLAIMER", "INTENT_DETECTION", ...],
  "turn_count": 0,
  "booking_code": null,
  "compliance_events": [],
  "error_events": []
}
```

Sessions expire after 10 minutes of inactivity with a graceful timeout message.

### Logging Levels

| Level | Events Logged |
|-------|--------------|
| INFO | Session start/end, state transitions, booking created |
| WARN | PII detected and blocked, advice request blocked, MCP email draft failure |
| ERROR | MCP Calendar/Notes failure, slot engine failure, booking code collision |
| AUDIT | Every MCP tool call with full payload (for compliance review) |

---

## 7. Module Dependency Map

```
                    +------------------------+
                    |    Voice Interface     |
                    |   (STT / TTS / Audio) |
                    +----------+-------------+
                               |
                    +----------v-------------+
                    |   Compliance Guard     | <--- runs first, always
                    +----------+-------------+
                               |
                    +----------v-------------+
                    |   Intent Classifier    |
                    +----------+-------------+
                               |
            +------------------v------------------+
            |       Conversation State Manager    |
            |               (FSM)                 |
            +----+----------+----------+----------+
                 |          |          |
       +---------v--+  +----v----+  +--v----------+
       | Slot Engine|  | Booking |  | Compliance  |
       | (Calendar) |  |  Code   |  | Rule Engine |
       |            |  |  Gen.   |  |             |
       +-----+------+  +---------+  +-------------+
             |
    +--------v---------+
    |  MCP Tool Router |
    +--+------+------+-+
       |      |      |
  +----v-+ +-v----+ +-v-------+
  | Cal. | | Note | | Email   |
  | MCP  | | MCP  | | Draft   |
  |      | |      | | MCP     |
  +------+ +------+ +---------+
```

---

## 8. Technology Recommendations

| Layer | Recommended Stack |
|-------|------------------|
| STT | Deepgram (Real-time Streaming API) |
| TTS | Google Cloud TTS (Neural2 / Journey voices) |
| AI / LLM Orchestration | Gemini (via @google/genai SDK) |
| MCP Server | FastAPI (Python) / Express (Node.js) |
| State Management | Redis (session store) / In-memory for mock |
| Booking Store DB | SQLite (via @modelcontextprotocol/server-sqlite) |
| Calendar Store | Google Calendar API / mock JSON store |
| Notes Store | Notion API / Airtable / mock JSON store |
| Email Drafts | Gmail Drafts API / mock JSON store |
| Logging | Structured JSON logs -> Cloud Logging / ELK Stack |
| Deployment | Docker + Cloud Run / Railway / Heroku |

---

## 9. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| PII leakage via voice | Compliance Guard pre-processor on every utterance |
| PII in logs | Log scrubbing — no user speech transcripts stored in production logs |
| MCP payload exposure | HTTPS-only MCP endpoints, API key auth per tool |
| Email auto-send | Email Draft MCP tool schema blocks `send` action; `approval_status` field required |
| Booking code guessing | Codes are alphanumeric, short but low-value (no PII linked) |
| Session hijacking | Sessions are transient, keyed by call_id, expire on disconnect |
| Secure link | External page uses HTTPS; contact details handled outside this system |

---

## 10. Deployment Architecture

```
+---------------------+     +----------------------+
|   Phone / WebRTC    | --> |  Voice Gateway       |
|   Caller Interface  |     |  (Twilio / LiveKit)  |
+---------------------+     +----------+-----------+
                                        |
                            +-----------v----------+
                            |   AI Voice Agent     |
                            |   (Docker Container) |
                            |                      |
                            |  - Compliance Guard  |
                            |  - Intent Classifier |
                            |  - State Manager     |
                            |  - Slot Engine       |
                            |  - Code Generator    |
                            +-----------+----------+
                                        |
                            +-----------v----------+
                            |   MCP Server         |
                            |   (REST / WebSocket) |
                            +-----------+----------+
                                        |
         +------------------+-----------+-----------+------------------+
         |                  |                       |                  |
 +-------v------+   +-------v-------+       +-------v------+   +-------v-------+
 | Calendar API |   | Notes API     |       | Email API    |   | SQLite DB     |
 | (mock/real)  |   | (mock/real)   |       | (mock/real)  |   | (Local File)  |
 +--------------+   +---------------+       +--------------+   +---------------+
```

---

## 11. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Compliance Guard runs before everything | Ensures zero chance of PII reaching any downstream system |
| MCP actions are strictly sequential | Enables rollback on failure; calendar is always source of truth |
| Email drafts never auto-sent | Regulatory requirement; advisor must review before any outbound communication |
| Exactly 2 slots always offered | Reduces cognitive load on caller; simplifies voice UX |
| Booking code is the only identifier on the call | Eliminates need for any PII during reschedule/cancel |
| Waitlist is a first-class flow, not an error state | Ensures no caller is left without a path forward |
| FSM-based state manager | Predictable, testable, auditable conversation paths |
| Modular MCP layer | Calendar, Notes, and Email backends can be swapped independently |
