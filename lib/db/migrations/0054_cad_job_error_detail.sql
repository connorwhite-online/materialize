-- Real failure detail for CAD jobs (observability): exception message +
-- stack + stage. `error` remains the user-facing copy; this column is the
-- debugging record that used to exist only in the dev console.
ALTER TABLE "cad_jobs" ADD COLUMN IF NOT EXISTS "error_detail" text;
