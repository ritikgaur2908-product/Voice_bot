import { classifyIntent, generateAgentResponse, ConversationTurn } from './gemini.js';
import { generateUniqueBookingCode, executeBookingTransaction, executeRescheduleTransaction, executeCancellationTransaction, getBookedSlotsForDate } from './mcpClient.js';

export interface SessionState {
  sessionId: string;
  currentState: string;
  intent: string | null;
  topic: string | null;
  preferredDay: string | null;
  preferredTime: string | null;
  offeredSlots: string[];
  selectedSlot: string | null;
  bookingCode: string | null;
  mcpStatus: string | null;
  turnCount: number;
  history: ConversationTurn[];
}

const PREDEFINED_TOPICS = [
  "KYC / Onboarding",
  "SIP / Mandates",
  "Statements / Tax Documents",
  "Withdrawals & Timelines",
  "Account Changes / Nominee"
];

// Helper to format Date to YYYY-MM-DD
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolves natural language days to YYYY-MM-DD absolute date relative to actual current IST date
 */
export function resolveDay(utterance: string): string | null {
  const normalized = utterance.toLowerCase();

  const nowUTC = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(nowUTC.getTime() + istOffsetMs);

  // Exact dates for our active booking window (July 13 - July 17, 2026)
  if (normalized.includes("13") || normalized.includes("thirteen")) return "2026-07-13";
  if (normalized.includes("14") || normalized.includes("fourteen")) return "2026-07-14";
  if (normalized.includes("15") || normalized.includes("fifteen")) return "2026-07-15";
  if (normalized.includes("16") || normalized.includes("sixteen")) return "2026-07-16";
  if (normalized.includes("17") || normalized.includes("seventeen")) return "2026-07-17";

  if (normalized.includes("today")) {
    return nowIST.toISOString().slice(0, 10);
  }
  if (normalized.includes("tomorrow")) {
    const tomorrowIST = new Date(nowIST);
    tomorrowIST.setUTCDate(nowIST.getUTCDate() + 1);
    return tomorrowIST.toISOString().slice(0, 10);
  }

  // Days of the week (using UTC methods on nowIST to prevent timezone double offset)
  const daysOfWeek = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < 7; i++) {
    if (normalized.includes(daysOfWeek[i])) {
      const targetDayIndex = i;
      const currentDayIndex = nowIST.getUTCDay();
      let diff = targetDayIndex - currentDayIndex;
      if (diff <= 0) diff += 7; // Next occurrence

      const targetDate = new Date(nowIST);
      targetDate.setUTCDate(nowIST.getUTCDate() + diff);
      return targetDate.toISOString().slice(0, 10);
    }
  }

  // YYYY-MM-DD regex check
  const dateRegex = /\b\d{4}-\d{2}-\d{2}\b/;
  const match = normalized.match(dateRegex);
  if (match) return match[0];

  return null;
}

/**
 * Resolves natural language time band
 */
export function resolveTimeBand(utterance: string): 'morning' | 'afternoon' | 'evening' | null {
  const normalized = utterance.toLowerCase();
  if (normalized.includes("morning") || normalized.includes("am")) return "morning";
  if (normalized.includes("afternoon")) return "afternoon";
  if (normalized.includes("evening") || normalized.includes("pm") || normalized.includes("night")) return "evening";
  return null;
}

/**
 * Resolves specific time from utterance (e.g. 11:30, 9:30, 11:30 AM, 3 PM)
 */
export function resolveSpecificTime(utterance: string): string | null {
  const normalized = utterance.toLowerCase();
  
  // Regex to match times like 11:30, 9:30, 2:00, 11:30 AM, 3 PM, etc.
  const timeRegex = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i;
  const match = normalized.match(timeRegex);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = match[3];
    if (ampm) {
      if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
    } else {
      if (hour >= 1 && hour <= 7) hour += 12;
    }
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  
  // Match simple "3 PM" or "11 AM" (without minutes)
  const hourRegex = /\b(\d{1,2})\s*(am|pm)\b/i;
  const hourMatch = normalized.match(hourRegex);
  if (hourMatch) {
    let hour = parseInt(hourMatch[1], 10);
    const ampm = hourMatch[2].toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:00`;
  }

  // Spoken words and standalone digits fallback
  if (/\b(11|eleven)\b/.test(normalized)) return "11:00";
  if (/\b(12|twelve)\b/.test(normalized)) return "12:00";
  if (/\b(2|two)\b/.test(normalized) && !normalized.includes("202")) return "14:00";
  if (/\b(3|three)\b/.test(normalized)) return "15:00";
  if (/\b(4|four)\b/.test(normalized)) return "16:00";
  if (/\b(5|five)\b/.test(normalized)) return "17:00";
  if (/\b(6|six)\b/.test(normalized)) return "18:00";

  return null;
}

/**
 * Resolves topic from utterance
 */
export function resolveTopic(utterance: string): string | null {
  const n = utterance.toLowerCase();
  if (n.includes("sip") || n.includes("mandate")) return "SIP / Mandates";
  if (n.includes("statement") || n.includes("tax") || n.includes("document")) return "Statements / Tax Documents";
  if (n.includes("withdrawal") || n.includes("timeline") || n.includes("money")) return "Withdrawals & Timelines";
  if (n.includes("nominee") || n.includes("change") || n.includes("account")) return "Account Changes / Nominee";
  if (n.includes("kyc") || n.includes("onboard") || n.includes("register")) return "KYC / Onboarding";
  return null;
}

/**
 * Returns fixed daily consultation slots for weekdays (Mon-Fri).
 * Saturday (6) and Sunday (0) return empty → triggers waitlist flow.
 * Each slot is a 1-hour window. The 'band' parameter filters by time-of-day preference.
 */
export function getOfferedSlots(dateStr: string, band: 'morning' | 'afternoon' | 'evening' | null, bookedSlots: string[] = []): string[] {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay();

  // Weekends closed → Waitlist flow
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [];
  }

  // Fixed daily slots (Mon–Fri)
  const allSlots = [
    "11:00",  // 11:00 AM – 12:00 PM
    "12:00",  // 12:00 PM – 1:00 PM
    "14:00",  // 2:00 PM – 3:00 PM
    "15:00",  // 3:00 PM – 4:00 PM
    "16:00",  // 4:00 PM – 5:00 PM
    "17:00",  // 5:00 PM – 6:00 PM
  ];

  let candidateSlots: string[] = allSlots;
  switch (band) {
    case "morning":
      candidateSlots = ["11:00", "12:00"];
      break;
    case "afternoon":
      candidateSlots = ["14:00", "15:00"];
      break;
    case "evening":
      candidateSlots = ["16:00", "17:00"];
      break;
    default:
      candidateSlots = allSlots;
      break;
  }

  return candidateSlots.filter(s => !bookedSlots.includes(s));
}

/**
 * Dynamic Prompt builder based on FSM State
 */
function getSystemPromptForState(state: string, session: SessionState): string {
  const disclaimer = "This assistant helps schedule advisor appointments only. It does not provide investment advice. Please do not share personal information such as your phone number, email address, PAN, Aadhaar, account number, or any sensitive financial information during this call.";

  // Always compute real current IST date/day for LLM context
  const nowUTC = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(nowUTC.getTime() + istOffsetMs);
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayName = dayNames[nowIST.getUTCDay()];
  const todayDate = nowIST.toISOString().slice(0, 10); // YYYY-MM-DD
  const tomorrowIST = new Date(nowIST);
  tomorrowIST.setUTCDate(nowIST.getUTCDate() + 1);
  const tomorrowName = dayNames[tomorrowIST.getUTCDay()];
  const tomorrowDate = tomorrowIST.toISOString().slice(0, 10);

  switch (state) {
    case "GREETING":
      return `Greet the user warmly with this exact message: "Welcome to Advisor AI! I'm here to help you schedule a session with your financial advisor. A quick reminder: this call is for scheduling only, and no investment advice or sensitive personal data should be shared. How can I assist you today?"`;

    case "INTENT_DETECTION":
      return `Understand the user's intent. If they want to book a new appointment, reschedule, or cancel, acknowledge and ask the appropriate follow-up question. Do not ask for any personal information.`;

    case "TOPIC_COLLECTION":
      return `We need to collect the consultation topic. The accepted topics are:
1. KYC / Onboarding
2. SIP / Mandates
3. Statements / Tax Documents
4. Withdrawals & Timelines
5. Account Changes / Nominee

Acknowledge their request and ask them to select one of these 5 topics. If they mentioned something close, map it to the nearest topic and confirm.`;

    case "DAY_COLLECTION":
      return `We are booking a slot for "${session.topic}".
IMPORTANT DATE CONTEXT (always use these facts):
- Today is ${todayName}, ${todayDate} (IST).
- Tomorrow is ${tomorrowName}, ${tomorrowDate} (IST).
- Do NOT suggest days or dates that are in the past.
- When saying "tomorrow", always say "${tomorrowName} (${tomorrowDate})".
Ask the user which day they prefer. List upcoming weekday options correctly based on today being ${todayName}.`;

    case "TIME_COLLECTION":
    case "SLOT_SELECTION":
    case "SLOT_OFFER": {
      return `We are scheduling a consultation for ${session.preferredDay}.
IMPORTANT CONSTRAINTS (YOU MUST STRICTLY FOLLOW THESE):
1. Our ONLY available consultation slots each weekday (Mon-Fri) are exactly these 6 fixed 1-hour slots:
   - 11:00 AM – 12:00 PM (IST)
   - 12:00 PM – 1:00 PM (IST)
   - 2:00 PM – 3:00 PM (IST)
   - 3:00 PM – 4:00 PM (IST)
   - 4:00 PM – 5:00 PM (IST)
   - 5:00 PM – 6:00 PM (IST)
2. Do NOT mention or invent any other time windows (never say 9 AM - 12 PM, 1 PM - 4 PM, or 5 PM - 7 PM).
3. Politely present these exact fixed slots (or group them into Morning: 11 AM & 12 PM, Afternoon: 2 PM & 3 PM, Evening: 4 PM & 5 PM). Ask the user which specific time slot they would like to book.
4. Do NOT state that the appointment has been successfully booked or confirmed yet! We must first confirm the chosen slot before booking.`;
    }

    case "CONFIRMATION": {
      const d = new Date(session.preferredDay || formatDate(new Date()));
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const dayOfWeekName = dayNames[d.getUTCDay()] || "Monday";
      return `You MUST respond with ONLY this exact confirmation message without any extra commentary or stories:
"We are ready to confirm your appointment. Here are your booking details:
Topic: ${session.topic}
Date: ${dayOfWeekName}, ${session.preferredDay}
Time: ${session.selectedSlot} IST.
Would you like me to go ahead and book this appointment for you? Please say yes or no."`;
    }

    case "MCP_EXECUTION":
      return `The booking has been successfully confirmed. The unique booking reference code is ${session.bookingCode}. Speak the code clearly, tell them their slot is locked as tentative. Direct them to click the button labeled "Verify & Complete Contact Details" displayed in the chat card to submit their contact info. Do NOT speak any raw URLs (like https://... or example.com).`;

    case "RESCHEDULE_CODE":
      return `Ask the user to state their booking reference code (e.g., AA-1234) so we can look up their appointment. Do not ask for any personal information.`;

    case "CANCEL_CODE":
      return `Ask the user to state their booking reference code (e.g., AA-1234) to proceed with cancellation. Do not ask for any personal information.`;

    case "CANCEL_CONFIRMATION":
      return `Confirm that the appointment with reference code ${session.bookingCode} has been successfully cancelled. Say goodbye.`;

    case "WAITLIST_OFFER":
      return `There are no slots available on Sunday, ${session.preferredDay}. Ask the user if they would like to be added to the waitlist for their topic "${session.topic}".`;

    case "WAITLIST_CONFIRMATION":
      return `They have been added to the waitlist. The waitlist reference code is ${session.bookingCode}. Inform them the advisor team will review availability and contact them.`;

    case "SLOT_ALREADY_BOOKED":
      return `State clearly without extra stories: "I apologize, but the requested time slot on ${session.preferredDay} is already booked by another client. Our currently available consultation slots for that day are: ${session.offeredSlots.join(", ")} (IST). Which of these available times would you like instead?"`;

    case "SLOTS_FULL":
      return `Inform the user politely that all consultation slots for ${session.preferredDay} are completely booked. Ask them which other weekday (Mon-Fri) they would like to check slots for.`;

    case "END":
      return `The conversation is completed. Wish them a good day and say goodbye.`;

    default:
      return `Assist the user in scheduling their advisor appointment. Remember: ${disclaimer}`;
  }
}

function extractBookingCode(text: string): string | null {
  const wordMap: { [key: string]: string } = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"
  };
  let processed = text.toLowerCase();
  for (const [word, digit] of Object.entries(wordMap)) {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    processed = processed.replace(regex, digit);
  }

  const cleaned = processed.toUpperCase().replace(/\s+/g, "");
  const match = cleaned.match(/([A-Z]{2})-?(\d{4})/);
  return match ? `${match[1]}-${match[2]}` : null;
}


/**
 * Processes a conversation turn, running the FSM transitions and calling Gemini
 */
export async function handleConversationTurn(
  session: SessionState,
  utterance: string
): Promise<{ replyText: string; stateUpdate: Partial<SessionState> }> {
  
  session.turnCount++;
  session.history.push({ role: 'user', text: utterance });
  
  let nextState = session.currentState;
  let update: Partial<SessionState> = {};

  // --- FSM STATE TRANSITIONS & DATA PROCESSING ---
  if (session.currentState === "GREETING") {
    if (!utterance || !utterance.trim()) {
      update.currentState = "INTENT_DETECTION";
      const prompt = getSystemPromptForState("GREETING", { ...session, ...update });
      const reply = await generateAgentResponse(prompt, session.history);
      session.history.push({ role: 'model', text: reply });
      return { replyText: reply, stateUpdate: update };
    } else {
      // User explicitly provided an utterance (e.g. quick chip or early speech) while in GREETING state!
      // Skip GREETING prompt and immediately process their input in INTENT_DETECTION.
      session.currentState = "INTENT_DETECTION";
    }
  } 
  const isBookingFlow = [
    "INTENT_DETECTION",
    "TOPIC_COLLECTION",
    "DAY_COLLECTION",
    "TIME_COLLECTION",
    "SLOT_SELECTION"
  ].includes(session.currentState);

  if (isBookingFlow) {
    let currentIntent = session.intent;
    
    // 1. Acknowledge intent if we are at INTENT_DETECTION
    if (session.currentState === "INTENT_DETECTION") {
      const intent = await classifyIntent(utterance);
      update.intent = intent;
      currentIntent = intent;
      
      if (intent === "INTENT_RESCHEDULE") {
        nextState = "RESCHEDULE_CODE";
        update.currentState = nextState;
        const prompt = getSystemPromptForState(nextState, { ...session, ...update });
        const reply = await generateAgentResponse(prompt, session.history);
        session.history.push({ role: 'model', text: reply });
        return { replyText: reply, stateUpdate: update };
      } else if (intent === "INTENT_CANCEL") {
        nextState = "CANCEL_CODE";
        update.currentState = nextState;
        const prompt = getSystemPromptForState(nextState, { ...session, ...update });
        const reply = await generateAgentResponse(prompt, session.history);
        session.history.push({ role: 'model', text: reply });
        return { replyText: reply, stateUpdate: update };
      } else if (intent === "INTENT_PREPARE") {
        const prompt = `Provide a concise list of general preparation requirements or documents needed for an advisor meeting (e.g. Identity proof, statements). Keep it under 3 sentences suitable for a voice response.`;
        const reply = await generateAgentResponse(prompt, session.history);
        update.currentState = "END";
        return { replyText: reply, stateUpdate: update };
      } else if (intent === "INTENT_AVAILABILITY") {
        update.intent = "INTENT_BOOK";
        currentIntent = "INTENT_BOOK";
      }
    }

    if (currentIntent === "INTENT_BOOK" || session.intent === "INTENT_BOOK") {
      // 2. Perform slot extraction
      const extractedTopic = resolveTopic(utterance);
      if (extractedTopic) {
        update.topic = extractedTopic;
        session.topic = extractedTopic;
      }

      const extractedDay = resolveDay(utterance);
      if (extractedDay) {
        update.preferredDay = extractedDay;
        session.preferredDay = extractedDay;
      }

      const activeDay = update.preferredDay || session.preferredDay || formatDate(new Date());
      const bookedSlots = await getBookedSlotsForDate(activeDay);

      const extractedTime = resolveSpecificTime(utterance);
      if (extractedTime) {
        if (bookedSlots.includes(extractedTime)) {
          // The requested exact time is already booked!
          update.selectedSlot = null as any;
          session.selectedSlot = null;
          const availableSlots = getOfferedSlots(activeDay, null, bookedSlots);
          update.offeredSlots = availableSlots;
          session.offeredSlots = availableSlots;
          nextState = availableSlots.length === 0 ? "SLOTS_FULL" : "SLOT_ALREADY_BOOKED";
        } else {
          update.selectedSlot = extractedTime;
          session.selectedSlot = extractedTime;
        }
      }

      // 3. Determine next FSM state based on filled slots
      if (nextState === "SLOT_ALREADY_BOOKED" || nextState === "SLOTS_FULL") {
        // Keep this error state so Gemini tells them immediately
      } else if (!session.topic && !update.topic) {
        nextState = "TOPIC_COLLECTION";
      } else if (!session.preferredDay && !update.preferredDay) {
        nextState = "DAY_COLLECTION";
      } else if (!session.selectedSlot && !update.selectedSlot) {
        const activeBand = (resolveTimeBand(utterance) || session.preferredTime) as 'morning' | 'afternoon' | 'evening' | null;
        
        if (activeBand) {
          update.preferredTime = activeBand;
          const slots = getOfferedSlots(activeDay, activeBand, bookedSlots);
          if (slots.length === 0) {
            const allUnfilteredForDay = getOfferedSlots(activeDay, activeBand, []);
            if (allUnfilteredForDay.length > 0) {
              nextState = "SLOTS_FULL";
            } else {
              nextState = "WAITLIST_OFFER";
            }
          } else {
            update.offeredSlots = slots;
            
            // Check if they are confirming one of the offered slots (e.g. "first", "second", or times)
            const normalizedUtterance = utterance.toLowerCase();
            const matchesFirst = slots[0] && (normalizedUtterance.includes(slots[0]) || normalizedUtterance.includes("first"));
            const matchesSecond = slots[1] && (normalizedUtterance.includes(slots[1]) || normalizedUtterance.includes("second"));
            
            if (matchesFirst || matchesSecond) {
              const chosen = matchesFirst ? slots[0] : slots[1];
              if (bookedSlots.includes(chosen)) {
                update.selectedSlot = null as any;
                session.selectedSlot = null;
                nextState = "SLOT_ALREADY_BOOKED";
              } else {
                update.selectedSlot = chosen;
                nextState = "CONFIRMATION";
              }
            } else {
              nextState = "SLOT_SELECTION";
            }
          }
        } else {
          nextState = "TIME_COLLECTION";
        }
      } else {
        // Check once more right before entering confirmation
        if (session.selectedSlot && bookedSlots.includes(session.selectedSlot)) {
          update.selectedSlot = null as any;
          session.selectedSlot = null;
          const availableSlots = getOfferedSlots(activeDay, null, bookedSlots);
          update.offeredSlots = availableSlots;
          session.offeredSlots = availableSlots;
          nextState = availableSlots.length === 0 ? "SLOTS_FULL" : "SLOT_ALREADY_BOOKED";
        } else {
          nextState = "CONFIRMATION";
        }
      }
    } else {
      nextState = "INTENT_DETECTION";
    }
  }
  else if (session.currentState === "CONFIRMATION" || session.currentState === "SLOT_SELECTION") {
    const isYes = /yes|yup|sure|confirm|ok/i.test(utterance);
    if (isYes) {
      if (!session.selectedSlot && session.offeredSlots && session.offeredSlots.length > 0) {
        update.selectedSlot = session.offeredSlots[0];
        session.selectedSlot = session.offeredSlots[0];
      } else if (!session.selectedSlot) {
        update.selectedSlot = "11:00";
        session.selectedSlot = "11:00";
      }
      nextState = "CODE_GENERATION";
    } else if (session.currentState === "CONFIRMATION") {
      const reply = "Booking cancelled. Let me know if you want to book another session. Goodbye!";
      update.currentState = "END";
      return { replyText: reply, stateUpdate: update };
    } else {
      nextState = "SLOT_SELECTION";
    }
  } 
  else if (session.currentState === "CODE_GENERATION") {
    // This state is hit in the background to execute booking
  }
  else if (session.currentState === "RESCHEDULE_CODE") {
    // Extract code
    const code = extractBookingCode(utterance);
    if (code) {
      update.bookingCode = code;
      nextState = "DAY_COLLECTION"; // Go collect new day
    }
  }
  else if (session.currentState === "CANCEL_CODE") {
    let code = extractBookingCode(utterance);
    const isYes = /yes|yup|sure|confirm|ok|correct/i.test(utterance);
    if (!code && isYes && session.bookingCode) {
      code = session.bookingCode;
    }
    if (code) {
      update.bookingCode = code;
      session.bookingCode = code;
      // Execute Cancellation immediately
      try {
        await executeCancellationTransaction(code);
        update.currentState = "CANCEL_CONFIRMATION";
        const reply = `Your appointment with booking code ${code} has been successfully cancelled. You will receive a cancellation email shortly. Have a great day!`;
        return { replyText: reply, stateUpdate: update };
      } catch (err: any) {
        console.error("Cancellation failed:", err);
        const reply = "I'm sorry, I couldn't process the cancellation. Please check your booking code and try again.";
        return { replyText: reply, stateUpdate: update };
      }
    }
  }
  else if (session.currentState === "WAITLIST_OFFER") {
    const isYes = /yes|yup|sure|confirm|ok/i.test(utterance);
    if (isYes) {
      const code = await generateUniqueBookingCode();
      update.bookingCode = code;
      
      // Execute waitlist sync
      try {
        await executeBookingTransaction(
          code, 
          session.topic || "General Q&A", 
          session.preferredDay || formatDate(new Date()), 
          "00:00", 
          "WAITLIST"
        );
        update.mcpStatus = "SUCCESS";
        nextState = "WAITLIST_CONFIRMATION";
      } catch (err) {
        console.error("Waitlist transaction failed:", err);
        update.currentState = "END";
        return { replyText: "I'm sorry, I couldn't add you to the waitlist at this moment. Goodbye.", stateUpdate: update };
      }
    } else {
      update.currentState = "END";
      return { replyText: "No problem. Let me know if you want to book for another day. Goodbye!", stateUpdate: update };
    }
  }

  // Handle transaction trigger for booking/rescheduling confirmation
  if (nextState === "CODE_GENERATION") {
    const code = await generateUniqueBookingCode();
    update.bookingCode = code;

    try {
      if (session.intent === "INTENT_RESCHEDULE" && session.bookingCode) {
        // Reschedule
        await executeRescheduleTransaction(
          session.bookingCode,
          session.topic || "General Q&A",
          session.preferredDay || formatDate(new Date()),
          session.selectedSlot || "10:30"
        );
      } else {
        // Create new
        await executeBookingTransaction(
          code,
          session.topic || "General Q&A",
          session.preferredDay || formatDate(new Date()),
          session.selectedSlot || "10:30"
        );
      }
      update.mcpStatus = "SUCCESS";
      nextState = "MCP_EXECUTION";
    } catch (err: any) {
      console.error("Transaction failed:", err);
      update.currentState = "END";
      return { replyText: "I encountered an error syncronizing with the database. Please try again later.", stateUpdate: update };
    }
  }

  // Update FSM state
  update.currentState = nextState;
  
  // Generate Conversational Reply using Gemini
  const prompt = getSystemPromptForState(nextState, { ...session, ...update });
  const reply = await generateAgentResponse(prompt, session.history);
  
  session.history.push({ role: 'model', text: reply });
  return { replyText: reply, stateUpdate: update };
}
