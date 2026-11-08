-- Host reorder (contract A) and "Intră la runda următoare" queue (contract B).
--  seat:      play order chosen by the host (0-based, null = not placed yet, sorts last by join time).
--  queued_at: a spectator asked to sit down at the next round; promoted in this order while seats are free.
-- Additive and idempotent. Run once in the Supabase SQL editor.
alter table public.yams_players add column if not exists seat integer;
alter table public.yams_players add column if not exists queued_at timestamptz;

notify pgrst, 'reload schema';
