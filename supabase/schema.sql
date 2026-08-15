-- Layer 1b §5 — the Postgres side.
--
-- Run this once against the Supabase project (SQL editor, or
-- `supabase db push`). It is written to be re-runnable: every statement
-- is guarded, so applying it twice is a no-op rather than an error.
--
-- NOT VERIFIED AGAINST A LIVE PROJECT. This file has no credentials to
-- run against, so it is reviewed SQL, not executed SQL. Acceptance tests
-- 17-22 in §9.4 cover exactly the behaviour defined here and are the
-- things to run first once the project exists.

-- ── §5.3 Own schema, not mixed into Kahiro's tables ──────────────────
create schema if not exists habits;

-- PostgREST only exposes schemas it has been told about. In Supabase:
--   Settings → API → Exposed schemas → add "habits"
-- The client sends Accept-Profile/Content-Profile: habits to select it.
grant usage on schema habits to authenticated;

-- ── §5.1 Schema parity with Layer 1, plus §4.1's columns ─────────────
-- Every constraint the local SQLite schema enforces is enforced here too.
-- The server is not a dumb bucket: a client with a stale build, or a bug,
-- must not be able to write a row the local schema would have refused.

create table if not exists habits.routines (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  icon        text,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null,
  updated_at  timestamptz not null
);

create table if not exists habits.habits (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  icon             text,
  question         text,
  type             text not null check (type in ('boolean','numeric')),
  unit             text,
  target           real,
  target_direction text not null default 'at_least' check (target_direction in ('at_least','at_most')),
  frequency_type   text not null check (frequency_type in ('daily','specific_days','times_per_week','times_per_month')),
  frequency_days   text,
  frequency_count  integer,
  routine_id       uuid references habits.routines(id),
  sort_order       integer not null default 0,
  color            text,
  reminder_time    text,
  archived_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null,
  updated_at       timestamptz not null,

  -- Layer 1 §4.2, restated as constraints rather than as trust.
  constraint habits_numeric_needs_target
    check (type <> 'numeric' or target is not null),
  constraint habits_boolean_has_no_target
    check (type <> 'boolean' or (target is null and unit is null)),
  constraint habits_specific_days_needs_days
    check (frequency_type <> 'specific_days' or frequency_days is not null),
  constraint habits_count_only_for_times_per
    check (
      (frequency_type in ('times_per_week','times_per_month') and frequency_count >= 1)
      or (frequency_type not in ('times_per_week','times_per_month') and frequency_count is null)
    )
);

create table if not exists habits.entries (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id   uuid not null references habits.habits(id) on delete cascade,

  -- §5.1: TEXT, not date, not timestamptz. A date type invites a driver
  -- or a session timezone to shift it by a day, which is the exact
  -- corruption Layer 1 §3 exists to prevent. Store the string, compare
  -- the string — YYYY-MM-DD sorts chronologically as text.
  date       text not null check (date ~ '^\d{4}-\d{2}-\d{2}$'),

  value      real not null,
  note       text,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- The constraint that makes duplicate habit-days structurally impossible,
-- here as well as locally. Scoped by user because two people may of
-- course log the same habit-day.
create unique index if not exists ux_entries_user_habit_date
  on habits.entries(user_id, habit_id, date);

-- Pull is "everything newer than my high-water mark", per table.
create index if not exists ix_routines_user_updated on habits.routines(user_id, updated_at);
create index if not exists ix_habits_user_updated   on habits.habits(user_id, updated_at);
create index if not exists ix_entries_user_updated  on habits.entries(user_id, updated_at);

-- ── §5.2 Row Level Security, on from the start ───────────────────────
alter table habits.routines enable row level security;
alter table habits.habits   enable row level security;
alter table habits.entries  enable row level security;

-- Belt and braces: FORCE applies RLS even to the table owner, so a
-- future definer-rights function cannot accidentally bypass it.
alter table habits.routines force row level security;
alter table habits.habits   force row level security;
alter table habits.entries  force row level security;

do $$
declare t text;
begin
  foreach t in array array['routines','habits','entries'] loop
    execute format('drop policy if exists %I_owner_all on habits.%I', t, t);
    -- One policy for all four verbs. USING gates what an existing row
    -- may be read/updated/deleted through; WITH CHECK gates what a row
    -- may be written AS, which is what stops user_id being spoofed
    -- (§9.4 test 18) even though the column has a default.
    execute format($f$
      create policy %I_owner_all on habits.%I
        for all
        to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $f$, t, t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema habits to authenticated;

-- ── updated_at is server-authoritative on the server ─────────────────
-- Conflict resolution (§7.3) compares updated_at, so a client that sends
-- a stale or invented value must not be able to win by lying about it.
-- The trigger keeps the column honest without touching the local model,
-- where the same value is generated in Layer 1.
create or replace function habits.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := greatest(now(), old.updated_at + interval '1 microsecond');
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['routines','habits','entries'] loop
    execute format('drop trigger if exists %I_touch_updated_at on habits.%I', t, t);
    execute format(
      'create trigger %I_touch_updated_at before update on habits.%I
         for each row execute function habits.touch_updated_at()', t, t);
  end loop;
end $$;

-- ── §5.3 Coexistence with Kahiro ─────────────────────────────────────
-- The single-writer rule: the habit app is the only writer to these
-- tables. Kahiro reads through a view and writes through one function.
-- Nothing above grants Kahiro direct write access; the grants are to
-- `authenticated`, and Kahiro runs as the same user, so the boundary is
-- enforced by what is exposed rather than by convention. Revoke direct
-- table access from any Kahiro-specific role you add later.

create or replace view habits.v_daily_completions
with (security_invoker = true) as
  select
    e.user_id,
    e.date,
    e.habit_id,
    h.name  as habit_name,
    h.type  as habit_type,
    h.unit,
    h.target,
    h.target_direction,
    e.value,
    -- Whether the day counts as done, decided here so Kahiro never has
    -- to reimplement Layer 2's completion rule and drift from it.
    case
      when h.type = 'boolean' then e.value >= 1
      when h.target_direction = 'at_least' then e.value >= h.target
      else e.value <= h.target
    end as completed
  from habits.entries e
  join habits.habits h on h.id = e.habit_id
  where e.deleted_at is null
    and h.deleted_at is null;

grant select on habits.v_daily_completions to authenticated;

-- §5.3 / §9.4 test 21. The one write path open to Kahiro. It applies the
-- same validation a local write would, so a rule cannot be enforced in
-- one app and skipped in the other.
create or replace function habits.habit_log_entry(
  p_habit_id uuid,
  p_date     text,
  p_value    real default null
) returns habits.entries
language plpgsql
security invoker
as $$
declare
  h habits.habits;
  result habits.entries;
begin
  if p_date !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'date must be a YYYY-MM-DD local calendar date, got %', p_date
      using errcode = '22007';
  end if;

  select * into h from habits.habits
   where id = p_habit_id and user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'no habit with id %', p_habit_id using errcode = 'P0002';
  end if;

  -- Layer 1 §4.2: a numeric habit logged without a value is not a
  -- completion, it is a missing amount. Refuse rather than guess.
  if h.type = 'numeric' and p_value is null then
    raise exception 'habit % is numeric and requires a value', p_habit_id
      using errcode = '23514';
  end if;

  insert into habits.entries (id, user_id, habit_id, date, value, created_at, updated_at)
  values (gen_random_uuid(), auth.uid(), p_habit_id, p_date,
          coalesce(p_value, 1), now(), now())
  on conflict (user_id, habit_id, date) do update
    set value = excluded.value,
        deleted_at = null,
        updated_at = now()
  returning * into result;

  return result;
end $$;

grant execute on function habits.habit_log_entry(uuid, text, real) to authenticated;
