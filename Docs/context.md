# Project Context

> **Source:** Derived from [`problemstatement.txt`](./problemstatement.txt)
> **Last Updated:** 2026-07-05

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Project Title** | AI Voice Agent – Advisor Appointment Scheduler |
| **Type** | AI-powered voice assistant |
| **Core Purpose** | Automate tentative appointment scheduling with human advisors |
| **Compliance Focus** | Zero PII collection during voice call |
| **Backend Protocol** | MCP (Model Context Protocol) |

---

## 2. Problem Being Solved

Organizations offering advisor consultations currently handle appointment scheduling **manually**. This project replaces that manual process with an AI voice assistant that:

- Understands the user's intent through natural conversation
- Finds and reserves available appointment slots
- Generates a unique booking reference
- Updates internal systems (calendar, notes, email draft) via MCP
- Directs the user to a secure webpage to submit contact details afterward

> The booking remains **tentative** until contact details are provided through the secure link.

---

## 3. What This System Is NOT

- Does **not** provide financial or investment advice
- Does **not** collect any PII (name, phone, email, PAN, Aadhaar, account number, etc.)
- Does **not** automatically send emails (drafts require human approval)

---

## 4. Supported User Intents

| # | Intent | Example Phrases |
|---|--------|----------------|
| 1 | Book a new appointment | "I want to speak with an advisor", "Book a consultation" |
| 2 | Reschedule an appointment | "Change my booking", "Can I reschedule?" |
| 3 | Cancel an appointment | "Cancel my appointment", "I no longer need the consultation" |
| 4 | Check preparation requirements | "What should I prepare?", "What documents do I need?" |
| 5 | Check advisor availability | "When is the next slot?", "Are there appointments tomorrow?" |

---

## 5. Supported Consultation Topics

The assistant accepts **only** these 5 predefined topics and must map similar user phrases to the nearest match:

1. KYC / Onboarding
2. SIP / Mandates
3. Statements / Tax Documents
4. Withdrawals & Timelines
5. Account Changes / Nominee

**Mapping example:** "My nominee needs updating" -> Account Changes / Nominee

---

## 6. Conversation Flow (Happy Path)

```
Greeting
   |
Compliance Disclaimer
   |
Determine User Intent
   |
Collect Consultation Topic
   |
Collect Preferred Day
   |
Collect Preferred Time
   |
Search Available Slots
   |
Offer Two Available Slots
   |
User Selects One Slot
   |
Repeat Date + Time + IST (Confirmation)
   |
Generate Booking Code
   |
Execute MCP Operations (Calendar Hold + Notes + Email Draft)
   |
Read Booking Code Aloud
   |
Provide Secure Completion Link
   |
End Conversation
```

---

## 7. Booking Code Format

A unique, human-readable, uppercase reference code is generated after confirmation.

```
Format:  AA-XXXX  or  LL-LLNN
Examples: AA-4837 | NL-A742
```

---

## 8. MCP Backend Integrations (4 Actions)

After the user confirms a booking, the assistant executes all four MCP actions sequentially:

### Action 1 — Booking Store DB Sync
- Syncs the tentative booking details directly with the central SQLite database (via @modelcontextprotocol/server-sqlite)
- Stores: booking code, topic, date, time, timezone (IST), status (TENTATIVE)

### Action 2 — Calendar Hold
- Creates a **tentative** calendar event
- Title format: `Advisor Q&A — {Topic} — {Booking Code}`
- Stores: topic, date, time, booking code
- Status: `Tentative`

### Action 3 — Notes Entry
- Appends a record to `Advisor Pre-Bookings`
- Fields: Date, Time, Topic, Booking Code, Status, Timestamp

### Action 4 — Draft Email
- Prepares an advisor notification email
- Status: `Draft / Pending Approval` — **NOT sent automatically**
- Includes: booking code, topic, scheduled slot, notes

---

## 9. Special Flows

### Rescheduling Flow
1. Ask for **booking code only** (no PII)
2. Read back current appointment
3. Offer two new slots
4. On confirmation: update calendar, notes, and email draft

### Cancellation Flow
1. Ask for **booking code only**
2. Cancel tentative hold
3. Update notes and email draft
4. Read confirmation back to user

### Availability Inquiry (No Booking Created)
- Respond with available appointment windows only
- Do not initiate a booking

### No Matching Slots - Waitlist
- Create a Waitlist Hold on the calendar
- Add a Waitlist Entry to notes
- Draft email: Notify Advisor of Waitlisted User
- Inform the user that the advisor team will review availability

---

## 10. Compliance Rules

### PII Never Requested (hard block)
Name, Phone, Email, PAN, Aadhaar, Account Number, Customer ID, Address, Date of Birth, Bank Details, OTP, Password

### If User Volunteers PII
Response: "Please do not share personal information during this call. You will receive a secure link after booking where those details can be submitted safely."

### Investment Advice Requests
Response: "I am unable to provide investment advice. I can help schedule an appointment with a qualified advisor or provide general educational resources."

### Mandatory Opening Disclaimer
Must be spoken **before any scheduling action**:
"This assistant helps schedule advisor appointments only. It does not provide investment advice. Please do not share personal information such as your phone number, email address, PAN, Aadhaar, account number, or any sensitive financial information during this call."

---

## 11. Secure Completion Link

After every successful booking, the assistant provides:

```
https://example.com/complete-booking
```

Users submit their contact details here — **never** during the voice call.

---

## 12. Error Scenarios to Handle

| Error | Expected Behavior |
|-------|-------------------|
| Unclear speech | Ask for clarification politely |
| Unsupported topic | Map to nearest topic or ask again |
| Invalid date / time | Prompt for a valid alternative |
| Booking code not found | Inform user, offer to book new appointment |
| MCP failure | Inform user, log error, attempt retry or graceful fallback |
| Calendar unavailable | Trigger waitlist flow |
| Duplicate booking | Warn user, ask for confirmation |
| User changes mind | Reset or return to previous step |
| User interrupts | Pause, acknowledge, and resume |

---

## 13. Data Models

### Booking
```
Booking Code | Topic | Date | Time | Timezone | Status | Created Timestamp | Updated Timestamp
```

### Notes Entry
```
Booking Code | Topic | Appointment Slot | Timestamp | Status
```

### Calendar Event
```
Title | Date | Time | Status | Booking Code
```

### Email Draft
```
Subject | Body | Approval Status | Booking Code
```

---

## 14. Non-Functional Requirements

| Requirement | Detail |
|-------------|--------|
| Latency | Low-latency voice responses |
| Intent Recognition | High reliability across all 5 intents |
| Failure Recovery | Graceful fallback on every error path |
| Security | Secure backend interactions, no PII in-flight |
| Architecture | Modular and easily extensible |
| Logging | Clear logs for all sessions and MCP calls |
| State Management | Full session state maintained across conversation turns |

---

## 15. Voice UX Guidelines

- Sound conversational, not robotic
- Avoid repeating the same phrase multiple times
- Confirm important information **once**
- Keep responses concise and scannable
- Maintain conversation context across turns
- Support mid-sentence interruptions gracefully
- Clarify ambiguity with a single, polite re-prompt

---

## 16. Success Criteria Checklist

- [ ] Identifies all 5 supported intents correctly
- [ ] Delivers compliance disclaimer before every interaction
- [ ] Never collects PII during the call
- [ ] Collects consultation topic (mapped to one of the 5 categories)
- [ ] Collects preferred scheduling window (day + time)
- [ ] Offers exactly 2 available appointment slots
- [ ] Confirms booking with topic, date, time, and IST timezone
- [ ] Generates a unique booking code (e.g., AA-4837)
- [ ] Syncs booking state with the central DB via MCP
- [ ] Creates a tentative calendar hold via MCP
- [ ] Appends notes entry via MCP
- [ ] Prepares an approval-gated email draft via MCP
- [ ] Provides secure completion URL
- [ ] Handles unavailable slots with waitlist workflow
- [ ] Refuses investment advice politely
- [ ] Maintains natural, fluid conversation throughout

---

## 17. Expected Deliverables

| Component | Description |
|-----------|-------------|
| Voice Conversation Workflow | End-to-end dialogue orchestration |
| Intent Classification Module | Classifies user input into one of 5 intents |
| Conversation State Manager | Tracks session state across turns |
| Mock Calendar Service | Simulates real calendar slot availability |
| Booking Code Generator | Produces unique, formatted codes |
| MCP Booking DB Integration | Syncs booking records with central DB |
| MCP Calendar Integration | Creates/updates calendar events |
| MCP Notes Integration | Appends pre-booking records |
| MCP Email Draft Integration | Drafts advisor emails (no auto-send) |
| Waitlist Workflow | Handles no-slot scenarios |
| Compliance Guardrails | Blocks PII collection and investment advice |
| Error Handling Logic | Graceful recovery across all error paths |
| Logging & Monitoring | Session and MCP call traceability |
| End-to-End Demo | Full working demonstration of appointment scheduling |

---

## 18. Evaluation Dimensions

This project is assessed across:

1. Voice conversation quality
2. Intent recognition accuracy
3. Conversation flow management
4. Calendar orchestration
5. MCP tool usage correctness
6. Compliance enforcement
7. Safe AI behavior
8. Error handling robustness
9. Overall user experience
