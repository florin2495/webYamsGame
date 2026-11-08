-- Yams multiplayer - Supabase schema
-- Every object is prefixed with yams_ because the Supabase project is shared by all hailatat.icu
-- mini-games. Keep the prefix on anything new: tables, constraints, indexes.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent; re-running drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- yams_rooms: one row per room. The running game (dice, score sheets, turn) lives in `game` as jsonb
-- and is only ever read by the server. `version` is an optimistic lock: every write is
-- "update ... where version = <read value>", so two actions at once cannot both apply.
-- ---------------------------------------------------------------------------
create table if not exists public.yams_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null
                   constraint yams_rooms_code_key unique
                   constraint yams_rooms_code_check check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null constraint yams_rooms_name_check check (char_length(name) between 1 and 40),
  password_hash    text,                                     -- scrypt hash, null = no password
  status           text not null default 'lobby'
                   constraint yams_rooms_status_check check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 constraint yams_rooms_round_check check (round >= 1),  -- game number in this room
  host_player_id   uuid,
  settings         jsonb not null default '{}'::jsonb,       -- turn timer
  game             jsonb,                                    -- null in the lobby
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()        -- idle rooms are deleted lazily
);
create index if not exists yams_rooms_status_activity_idx on public.yams_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- yams_players: members of a room, players (max 16) and spectators (role observer, max 16:
-- they joined during a game and sit down at the next one).
-- Identity = random token kept by the browser, only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.yams_players (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null constraint yams_players_room_id_fkey references public.yams_rooms (id) on delete cascade,
  nickname          text not null constraint yams_players_nickname_check check (char_length(nickname) between 1 and 20),
  token_hash        text not null constraint yams_players_token_hash_key unique,
  is_host           boolean not null default false,
  role              text not null default 'player' constraint yams_players_role_check check (role in ('player', 'observer')),
  ready             boolean not null default false,
  joined_at         timestamptz not null default now(),
  kick_requested_at timestamptz,                             -- pending kick during a game (10 s to press "Ignoră")
  last_seen_at      timestamptz not null default now(),      -- presence: disconnected after 45 s, see migrations/002
  device_hash       text,                                    -- sha256 of the browser's device id, see migrations/002
  seat              integer,                                 -- host-chosen play order, see migrations/003
  queued_at         timestamptz                              -- spectator waiting for the next round, see migrations/003
);
-- Existing databases: the lines above only apply to a fresh table (migrations/002_reconnect.sql, 003_seat_queue.sql).
alter table public.yams_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.yams_players add column if not exists device_hash text;
alter table public.yams_players add column if not exists seat integer;
alter table public.yams_players add column if not exists queued_at timestamptz;
create unique index if not exists yams_players_room_nickname_uq on public.yams_players (room_id, lower(nickname));
create index if not exists yams_players_room_idx on public.yams_players (room_id);
create index if not exists yams_players_room_seen_idx on public.yams_players (room_id, last_seen_at);

do $$ begin
  alter table public.yams_rooms
    add constraint yams_rooms_host_fk foreign key (host_player_id) references public.yams_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (the Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.yams_rooms   enable row level security;
alter table public.yams_players enable row level security;

revoke all on public.yams_rooms, public.yams_players from anon, authenticated;

-- Let the Data API (PostgREST) see the new tables immediately.
notify pgrst, 'reload schema';

-- Check: should list the 2 yams_ tables, both with rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'yams\_%' order by 1;
