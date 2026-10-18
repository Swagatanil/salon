-- Ek baar chalane wali migration: purani (already deployed) database mein
-- seat_number column aur uski uniqueness constraint add karta hai.
-- Agar aap naye sire se deploy kar rahe hain to iski zaroorat nahi — schema.sql kaafi hai.

ALTER TABLE bookings ADD COLUMN seat_number INTEGER NOT NULL DEFAULT 1;

-- Jo purani bookings same date/time par clash kar rahi hain (jaise 2 log ek
-- hi slot mein), unko alag-alag seat number de do taaki unique constraint lag sake.
UPDATE bookings
SET seat_number = (
  SELECT COUNT(*)
  FROM bookings b2
  WHERE b2.booking_date = bookings.booking_date
    AND b2.booking_time = bookings.booking_time
    AND b2.status != 'cancelled'
    AND b2.id <= bookings.id
)
WHERE status != 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_seat
  ON bookings (booking_date, booking_time, seat_number)
  WHERE status != 'cancelled';
