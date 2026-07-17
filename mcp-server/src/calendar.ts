import { google } from 'googleapis';
import { getGoogleAuthClient, isMockMode } from './auth.js';

let calendarClient: any = null;

// Mock calendar storage for simulation
const mockCalendarStore: Record<string, any> = {};

export function getCalendarClient() {
  if (calendarClient) return calendarClient;
  const auth = getGoogleAuthClient();
  if (isMockMode() || !auth) {
    return null;
  }
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

export async function createCalendarEvent(topic: string, date: string, time: string, bookingCode: string, status: string = 'TENTATIVE') {
  const client = getCalendarClient();
  const title = `Advisor Q&A — ${topic} — ${bookingCode}`;
  
  // Format date and time
  const startDateTime = new Date(`${date}T${time}:00`).toISOString();
  const endDateTime = new Date(new Date(`${date}T${time}:00`).getTime() + 60 * 60 * 1000).toISOString();

  if (isMockMode() || !client) {
    console.error(`[Google Calendar] [MOCK] Creating event: "${title}" on ${startDateTime} to ${endDateTime}`);
    const mockEventId = `mock-cal-ev-${Math.random().toString(36).substring(2, 11)}`;
    const mockEvent = {
      id: mockEventId,
      summary: title,
      start: { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
      end: { dateTime: endDateTime, timeZone: 'Asia/Kolkata' },
      description: `Booking code: ${bookingCode}, Status: ${status}`,
    };
    mockCalendarStore[bookingCode] = mockEvent;
    return { success: true, eventId: mockEventId, mock: true, event: mockEvent };
  }

  try {
    const response = await client.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: title,
        description: `Booking code: ${bookingCode}, Status: ${status}`,
        start: { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
        end: { dateTime: endDateTime, timeZone: 'Asia/Kolkata' },
      },
    });
    return { success: true, eventId: response.data.id, mock: false, event: response.data };
  } catch (error: any) {
    console.error('[Google Calendar] Failed to create event:', error.message);
    throw error;
  }
}

export async function updateCalendarEvent(bookingCode: string, newTopic: string, newDate: string, newTime: string, newStatus: string) {
  const client = getCalendarClient();
  const title = `Advisor Q&A — ${newTopic} — ${bookingCode}`;
  const startDateTime = new Date(`${newDate}T${newTime}:00`).toISOString();
  const endDateTime = new Date(new Date(`${newDate}T${newTime}:00`).getTime() + 60 * 60 * 1000).toISOString();

  if (isMockMode() || !client) {
    const mockEvent = mockCalendarStore[bookingCode];
    if (!mockEvent) {
      console.warn(`[Google Calendar] [MOCK] Update requested for non-existent booking code: ${bookingCode}. Simulating creation.`);
      return createCalendarEvent(newTopic, newDate, newTime, bookingCode, newStatus);
    }
    console.error(`[Google Calendar] [MOCK] Updating event for ${bookingCode}: "${title}" to ${startDateTime}`);
    mockEvent.summary = title;
    mockEvent.start.dateTime = startDateTime;
    mockEvent.end.dateTime = endDateTime;
    mockEvent.description = `Booking code: ${bookingCode}, Status: ${newStatus}`;
    return { success: true, eventId: mockEvent.id, mock: true, event: mockEvent };
  }

  try {
    const listRes = await client.events.list({
      calendarId: 'primary',
      q: bookingCode,
    });
    const events = listRes.data.items || [];
    if (events.length === 0) {
      throw new Error(`Google Calendar event for booking ${bookingCode} not found.`);
    }
    const eventId = events[0].id;
    const response = await client.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: {
        summary: title,
        start: { dateTime: startDateTime },
        end: { dateTime: endDateTime },
        description: `Booking code: ${bookingCode}, Status: ${newStatus}`,
      },
    });
    return { success: true, eventId: response.data.id, mock: false, event: response.data };
  } catch (error: any) {
    console.error(`[Google Calendar] Failed to update event for ${bookingCode}:`, error.message);
    throw error;
  }
}

export async function deleteCalendarEvent(bookingCode: string) {
  const client = getCalendarClient();

  if (isMockMode() || !client) {
    const mockEvent = mockCalendarStore[bookingCode];
    if (!mockEvent) {
      console.warn(`[Google Calendar] [MOCK] Delete requested for non-existent booking code: ${bookingCode}`);
      return { success: true, mock: true };
    }
    console.error(`[Google Calendar] [MOCK] Deleting event: ${mockEvent.id} for booking code: ${bookingCode}`);
    delete mockCalendarStore[bookingCode];
    return { success: true, mock: true };
  }

  try {
    const listRes = await client.events.list({
      calendarId: 'primary',
      q: bookingCode,
    });
    const events = listRes.data.items || [];
    if (events.length === 0) {
      console.warn(`[Google Calendar] Event for booking ${bookingCode} not found for deletion.`);
      return { success: true, info: 'No calendar event found to delete' };
    }
    const eventId = events[0].id;
    await client.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
    return { success: true, mock: false };
  } catch (error: any) {
    console.error(`[Google Calendar] Failed to delete event for ${bookingCode}:`, error.message);
    throw error;
  }
}
