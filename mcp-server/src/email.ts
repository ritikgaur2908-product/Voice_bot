import { google } from 'googleapis';
import { getGoogleAuthClient, isMockMode } from './auth.js';
import dotenv from 'dotenv';

dotenv.config();

function getDefaultUserEmail() {
  return process.env.ADVISOR_EMAIL || 'advisor@example.com';
}

let gmailClient: any = null;

// Mock drafts storage for simulation
const mockDraftsStore: Record<string, any> = {};

export function getGmailClient() {
  if (gmailClient) return gmailClient;
  const auth = getGoogleAuthClient();
  if (isMockMode() || !auth) {
    return null;
  }
  gmailClient = google.gmail({ version: 'v1', auth });
  return gmailClient;
}

export async function createGmailDraft(topic: string, date: string, time: string, bookingCode: string, status: string = 'TENTATIVE') {
  const client = getGmailClient();
  const subject = `Booking Notification: ${bookingCode} - ${status}`;
  const body = `Hello Advisor,\n\nA pre-booking has been created on your schedule:\n\n` +
               `- Booking Code: ${bookingCode}\n` +
               `- Topic: ${topic}\n` +
               `- Date & Time: ${date} at ${time} (IST)\n` +
               `- Status: ${status}\n` +
               `- Approval Status: PENDING\n\n` +
               `This is a system generated notification. Please review the details in the ledger.`;

  const userEmail = getDefaultUserEmail();

  if (isMockMode() || !client) {
    console.error(`[Gmail Drafts] [MOCK] Creating draft to ${userEmail} with subject: "${subject}"`);
    const mockDraftId = `mock-draft-${Math.random().toString(36).substring(2, 11)}`;
    const mockDraft = {
      id: mockDraftId,
      message: {
        id: `mock-msg-${Math.random().toString(36).substring(2, 11)}`,
        threadId: `mock-thread-${Math.random().toString(36).substring(2, 11)}`,
      },
      subject,
      body,
      to: userEmail,
    };
    mockDraftsStore[bookingCode] = mockDraft;
    return { success: true, draftId: mockDraftId, mock: true, draft: mockDraft };
  }

  try {
    const emailLines = [
      `To: ${userEmail}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const rawMessage = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await client.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw: rawMessage,
        },
      },
    });
    return { success: true, draftId: response.data.id, mock: false, draft: response.data };
  } catch (error: any) {
    console.error('[Gmail Drafts] Failed to create draft:', error.message);
    throw error;
  }
}

export async function updateGmailDraft(
  bookingCode: string,
  newTopic: string,
  newDate: string,
  newTime: string,
  newStatus: string,
  name?: string,
  email?: string,
  phone?: string,
  notes?: string
) {
  const client = getGmailClient();
  const subject = `Booking Notification Update: ${bookingCode} - ${newStatus}`;
  let body = `Hello Advisor,\n\nA pre-booking has been UPDATED on your schedule:\n\n` +
               `- Booking Code: ${bookingCode}\n` +
               `- Topic: ${newTopic}\n` +
               `- Date & Time: ${newDate} at ${newTime} (IST)\n` +
               `- Status: ${newStatus}\n` +
               `- Approval Status: PENDING\n\n`;

  if (name || email || phone || notes) {
    body += `Client Contact Information:\n`;
    if (name) body += `- Name: ${name}\n`;
    if (email) body += `- Email: ${email}\n`;
    if (phone) body += `- Phone: ${phone}\n`;
    if (notes) body += `- Notes: ${notes}\n`;
    body += `\n`;
  }

  body += `This is a system generated notification. Please review the details in the ledger.`;

  if (isMockMode() || !client) {
    const mockDraft = mockDraftsStore[bookingCode];
    if (!mockDraft) {
      console.warn(`[Gmail Drafts] [MOCK] Update requested for non-existent booking code: ${bookingCode}. Simulating creation.`);
      return createGmailDraft(newTopic, newDate, newTime, bookingCode, newStatus);
    }
    console.error(`[Gmail Drafts] [MOCK] Updating draft for ${bookingCode} to subject: "${subject}"`);
    mockDraft.subject = subject;
    mockDraft.body = body;
    return { success: true, draftId: mockDraft.id, mock: true, draft: mockDraft };
  }

  try {
    const listRes = await client.users.drafts.list({
      userId: 'me',
      q: bookingCode,
    });
    const drafts = listRes.data.drafts || [];
    if (drafts.length === 0) {
      console.warn(`[Gmail Drafts] Draft for booking ${bookingCode} not found for updating. Creating new one.`);
      return createGmailDraft(newTopic, newDate, newTime, bookingCode, newStatus);
    }

    const draftId = drafts[0].id;
    const emailLines = [
      `To: ${getDefaultUserEmail()}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      body,
    ];
    const rawMessage = Buffer.from(emailLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await client.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: {
        message: {
          raw: rawMessage,
        },
      },
    });
    return { success: true, draftId: response.data.id, mock: false, draft: response.data };
  } catch (error: any) {
    console.error(`[Gmail Drafts] Failed to update draft for ${bookingCode}:`, error.message);
    throw error;
  }
}
