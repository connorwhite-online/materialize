-- Postgres NOTIFY hook for the notification SSE bell. The
-- /api/notifications/stream handler holds an open Neon WebSocket
-- session running `LISTEN notifications` so it can push a fresh
-- snapshot the instant a new row arrives, without having to poll the
-- DB on a 5s timer per active stream.
--
-- We pg_notify only the (userId, id) tuple — the listener still
-- re-fetches the snapshot via the existing indexed query so the
-- channel payload stays well under the 8000-byte NOTIFY ceiling
-- regardless of how big the payload jsonb gets.

CREATE OR REPLACE FUNCTION notify_notifications_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'notifications',
    json_build_object('userId', NEW.user_id, 'id', NEW.id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS notifications_notify_insert ON notifications;
--> statement-breakpoint
CREATE TRIGGER notifications_notify_insert
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION notify_notifications_insert();
