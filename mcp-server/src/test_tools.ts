import { initDb, createBooking, updateBooking, deleteBooking, lookupBooking, listAllBookings } from './db.js';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './calendar.js';
import { appendLedgerRecord, updateLedgerRecord } from './notes.js';
import { createGmailDraft, updateGmailDraft } from './email.js';

async function runTests() {
  console.error("Starting integration tests...");

  // 1. Init Database
  await initDb();
  console.error("DB Initialized successfully.");

  const testCode = "AA-TEST1";

  // Remove preexisting test booking if it exists
  try {
    const existing = lookupBooking(testCode);
    if (existing) {
      deleteBooking(testCode);
      console.error("Cleaned up existing test booking.");
    }
  } catch (e) {}

  // 2. Test DB Create
  console.error("\n--- Testing DB Create ---");
  const created = createBooking({
    booking_code: testCode,
    topic: "Tax Advice Q&A",
    date: "2026-07-15",
    time: "10:00",
    timezone: "IST",
    status: "TENTATIVE"
  });
  console.error("Created booking in DB:", created);

  // 3. Test DB Lookup
  console.error("\n--- Testing DB Lookup ---");
  const found = lookupBooking(testCode);
  console.error("Found booking in DB:", found);

  // 4. Test Calendar Create (Mocked)
  console.error("\n--- Testing Calendar Event Creation ---");
  const calRes = await createCalendarEvent("Tax Advice Q&A", "2026-07-15", "10:00", testCode, "TENTATIVE");
  console.error("Calendar Event Response:", calRes);

  // 5. Test Sheets Append (Mocked)
  console.error("\n--- Testing Sheets Ledger Appending ---");
  const sheetsRes = await appendLedgerRecord("2026-07-15", "10:00", "Tax Advice Q&A", testCode, "TENTATIVE");
  console.error("Sheets Append Response:", sheetsRes);

  // 6. Test Gmail Draft Create (Mocked)
  console.error("\n--- Testing Gmail Draft Creation ---");
  const draftRes = await createGmailDraft("Tax Advice Q&A", "2026-07-15", "10:00", testCode, "TENTATIVE");
  console.error("Gmail Draft Response:", draftRes);

  // 7. Test DB Update
  console.error("\n--- Testing DB Update ---");
  const updated = updateBooking(testCode, {
    time: "11:30",
    status: "CONFIRMED"
  });
  console.error("Updated booking in DB:", updated);

  // 8. Test Calendar Update (Mocked)
  console.error("\n--- Testing Calendar Event Update ---");
  const calUpdateRes = await updateCalendarEvent(testCode, "Tax Advice Q&A", "2026-07-15", "11:30", "CONFIRMED");
  console.error("Calendar Update Response:", calUpdateRes);

  // 9. Test Sheets Update (Mocked)
  console.error("\n--- Testing Sheets Ledger Update ---");
  const sheetsUpdateRes = await updateLedgerRecord(testCode, "CONFIRMED", "2026-07-15", "11:30");
  console.error("Sheets Update Response:", sheetsUpdateRes);

  // 10. Test Gmail Draft Update (Mocked)
  console.error("\n--- Testing Gmail Draft Update ---");
  const draftUpdateRes = await updateGmailDraft(testCode, "Tax Advice Q&A", "2026-07-15", "11:30", "CONFIRMED");
  console.error("Gmail Draft Update Response:", draftUpdateRes);

  // 11. Test List All
  console.error("\n--- Listing All Bookings ---");
  const all = listAllBookings();
  console.error("All bookings in DB:", all);

  // 12. Test Delete
  console.error("\n--- Testing Deletion ---");
  const deleted = deleteBooking(testCode);
  console.error("Deleted booking from DB:", deleted);

  const finalCheck = lookupBooking(testCode);
  console.error("Lookup after deletion (should show CANCELLED status):", finalCheck);

  // 13. Test Calendar Delete (Mocked)
  console.error("\n--- Testing Calendar Event Deletion ---");
  const calDelRes = await deleteCalendarEvent(testCode);
  console.error("Calendar Delete Response:", calDelRes);

  console.error("\nAll tests completed successfully!");
}

runTests().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
