import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { getGoogleAuthClient, isMockMode } from './auth.js';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpRoot = path.resolve(__dirname, '..');

function getSpreadsheetId(): string {
  return process.env.GOOGLE_SPREADSHEET_ID || '';
}
const simulatedLedgerPath = path.resolve(mcpRoot, './simulated_ledger.json');

let sheetsClient: any = null;

export function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const auth = getGoogleAuthClient();
  const spreadsheetId = getSpreadsheetId();
  if (isMockMode() || !auth || !spreadsheetId) {
    return null;
  }
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// Read/write from local mock ledger
function readMockLedger(): any[] {
  if (fs.existsSync(simulatedLedgerPath)) {
    try {
      return JSON.parse(fs.readFileSync(simulatedLedgerPath, 'utf8'));
    } catch {
      return [];
    }
  }
  return [];
}

function writeMockLedger(data: any[]) {
  fs.writeFileSync(simulatedLedgerPath, JSON.stringify(data, null, 2), 'utf8');
}

export async function appendLedgerRecord(date: string, time: string, topic: string, bookingCode: string, status: string = 'TENTATIVE') {
  const client = getSheetsClient();
  const timestamp = new Date().toISOString();
  const values = [date, time, topic, bookingCode, status, timestamp];

  if (isMockMode() || !client) {
    console.error(`[Google Sheets] [MOCK] Appending ledger record:`, values);
    const ledger = readMockLedger();
    ledger.push({
      date,
      time,
      topic,
      booking_code: bookingCode,
      status,
      timestamp
    });
    writeMockLedger(ledger);
    return { success: true, mock: true, record: values };
  }

  try {
    const response = await client.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Sheet1!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [values],
      },
    });
    return { success: true, mock: false, response: response.data };
  } catch (error: any) {
    console.error('[Google Sheets] Failed to append ledger record:', error.message);
    throw error;
  }
}

export async function updateLedgerRecord(
  bookingCode: string, 
  status: string, 
  date?: string, 
  time?: string,
  name?: string,
  email?: string,
  phone?: string,
  notes?: string
) {
  const client = getSheetsClient();
  const timestamp = new Date().toISOString();

  if (isMockMode() || !client) {
    console.error(`[Google Sheets] [MOCK] Updating ledger record for ${bookingCode} to status=${status}`);
    const ledger = readMockLedger();
    const index = ledger.findIndex(row => row.booking_code === bookingCode);
    if (index !== -1) {
      ledger[index].status = status;
      if (date) ledger[index].date = date;
      if (time) ledger[index].time = time;
      ledger[index].timestamp = timestamp;
      if (name !== undefined) ledger[index].name = name;
      if (email !== undefined) ledger[index].email = email;
      if (phone !== undefined) ledger[index].phone = phone;
      if (notes !== undefined) ledger[index].notes = notes;
      writeMockLedger(ledger);
      return { success: true, mock: true, updated: ledger[index] };
    } else {
      console.warn(`[Google Sheets] [MOCK] Ledger record for booking ${bookingCode} not found for updating. Appending instead.`);
      return appendLedgerRecord(date || '', time || '', 'Rescheduled / Cancelled unknown topic', bookingCode, status);
    }
  }

  try {
    const getRes = await client.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Sheet1!A:J',
    });
    const rows = getRes.data.values || [];
    
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][3] === bookingCode) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      return appendLedgerRecord(date || '', time || '', 'Rescheduled / Cancelled', bookingCode, status);
    }

    const existingRow = rows[rowIndex - 1] || [];

    // Update E:J (Status, Timestamp, Name, Email, Phone, Notes) preserving existing values if not passed
    const updateRange = `Sheet1!E${rowIndex}:J${rowIndex}`;
    const updateValues = [
      status, 
      timestamp, 
      name !== undefined ? name : (existingRow[6] || ''), 
      email !== undefined ? email : (existingRow[7] || ''), 
      phone !== undefined ? phone : (existingRow[8] || ''), 
      notes !== undefined ? notes : (existingRow[9] || '')
    ];

    if (date && time) {
      await client.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `Sheet1!A${rowIndex}:B${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[date, time]]
        }
      });
    }

    const response = await client.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [updateValues],
      },
    });

    return { success: true, mock: false, response: response.data };
  } catch (error: any) {
    console.error(`[Google Sheets] Failed to update ledger record for ${bookingCode}:`, error.message);
    throw error;
  }
}
