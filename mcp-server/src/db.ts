import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpRoot = path.resolve(__dirname, '..');

const dbPath = path.resolve(mcpRoot, process.env.SQLITE_DB_PATH || './bookings.db');

let db: any = null;

export async function initDb() {
  if (db) return;
  const SQL = await initSqlJs();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS bookings (
        booking_code TEXT PRIMARY KEY,
        topic        TEXT NOT NULL,
        date         TEXT NOT NULL,
        time         TEXT NOT NULL,
        timezone     TEXT DEFAULT 'IST',
        status       TEXT DEFAULT 'TENTATIVE',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `);
    saveDb();
  }
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export interface Booking {
  booking_code: string;
  topic: string;
  date: string;
  time: string;
  timezone?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export function createBooking(booking: Booking) {
  if (!db) throw new Error("Database not initialized");
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO bookings (booking_code, topic, date, time, timezone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      booking.booking_code,
      booking.topic,
      booking.date,
      booking.time,
      booking.timezone || 'IST',
      booking.status || 'TENTATIVE',
      now,
      now
    ]
  );
  saveDb();
  return lookupBooking(booking.booking_code);
}

export function updateBooking(bookingCode: string, updates: Partial<Omit<Booking, 'booking_code'>>) {
  if (!db) throw new Error("Database not initialized");
  const now = new Date().toISOString();
  
  const current = lookupBooking(bookingCode);
  if (!current) {
    throw new Error(`Booking ${bookingCode} not found`);
  }

  const newTopic = updates.topic !== undefined ? updates.topic : current.topic;
  const newDate = updates.date !== undefined ? updates.date : current.date;
  const newTime = updates.time !== undefined ? updates.time : current.time;
  const newTimezone = updates.timezone !== undefined ? updates.timezone : current.timezone;
  const newStatus = updates.status !== undefined ? updates.status : current.status;

  db.run(
    `UPDATE bookings 
     SET topic = ?, date = ?, time = ?, timezone = ?, status = ?, updated_at = ?
     WHERE booking_code = ?`,
    [newTopic, newDate, newTime, newTimezone, newStatus, now, bookingCode]
  );
  saveDb();
  return lookupBooking(bookingCode);
}

export function deleteBooking(bookingCode: string) {
  if (!db) throw new Error("Database not initialized");
  const now = new Date().toISOString();
  
  const current = lookupBooking(bookingCode);
  if (!current) {
    throw new Error(`Booking ${bookingCode} not found`);
  }

  db.run(
    `UPDATE bookings 
     SET status = 'CANCELLED', updated_at = ?
     WHERE booking_code = ?`,
    [now, bookingCode]
  );
  saveDb();
  return lookupBooking(bookingCode);
}

export function lookupBooking(bookingCode: string): Booking | null {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare("SELECT * FROM bookings WHERE booking_code = ?");
  stmt.bind([bookingCode]);
  let result: any = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

export function listAllBookings(): Booking[] {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare("SELECT * FROM bookings ORDER BY created_at DESC");
  const list: Booking[] = [];
  while (stmt.step()) {
    list.push(stmt.getAsObject() as any);
  }
  stmt.free();
  return list;
}

/**
 * Returns all booked time slots for a given date (excludes CANCELLED bookings).
 */
export function getBookedSlots(date: string): string[] {
  if (!db) throw new Error("Database not initialized");
  const stmt = db.prepare(
    "SELECT time FROM bookings WHERE date = ? AND status != 'CANCELLED'"
  );
  stmt.bind([date]);
  const slots: string[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    if (row.time) slots.push(row.time);
  }
  stmt.free();
  return slots;
}
