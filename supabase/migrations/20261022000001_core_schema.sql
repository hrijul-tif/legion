-- MOS prototype: procedures, snapshots and their audited lifecycle.
-- Every state change goes through a SECURITY DEFINER function below; tables are read-only to clients.

create extension if not exists citext with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.mos_role as enum ('author', 'reviewer', 'tester', 'approver', 'admin');

create type public.snapshot_state as enum (
  'in_progress',        -- 1  working copy, editable by its author
  'ready_for_review',   -- 2
  'review_failed',      -- 3b terminal
  'test_in_progress',   -- 3a review passed, test in progress
  'test_failed',        -- 4b
  'approval_pending',   -- 4a tests passed, awaiting approval
  'approval_failed',    -- 5b
  'approved',           -- 5a the active snapshot, available in PROD
  'superseded',         -- 5c
  'withdrawn'           -- 5d
);

create type public.snapshot_action as enum (
  'create',       -- working copy created (null -> in_progress)
  'submit',       -- 1 -> 2
  'review_pass',  -- 2 -> 3a
  'review_fail',  -- 2 -> 3b
  'test_pass',    -- 3a -> 4a
  'test_fail',    -- 3a -> 4b
  'retest',       -- 4b -> 3a
  'approve',      -- 4a -> 5a
  'refuse',       -- 4a -> 5b
  'send_back',    -- 5b -> 3a
  'supersede',    -- 5a -> 5c (system, when another snapshot becomes active)
  'reactivate',   -- 5c/5d -> 5a (rollback)
  'withdraw'      -- 5c -> 5d
);

create type public.procedure_event_kind as enum ('created', 'retired', 'restored', 'working_copy_discarded');
create type public.test_result as enum ('pass', 'fail', 'blocked');
create type public.run_target as enum ('mock', 'bifrost');
create type public.run_outcome as enum ('running', 'completed', 'skipped', 'stopped', 'choose', 'error');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null,
  initials     text not null,
  color        text not null default '#6366f1',
  title        text,
  roles        public.mos_role[] not null default '{author}',
  created_at   timestamptz not null default now()
);
comment on table public.profiles is 'MOS users. Roles live here (not in the JWT) so a change takes effect immediately.';

create table public.app_settings (
  id                 boolean primary key default true check (id),
  allow_self_actions boolean not null default false
);
comment on column public.app_settings.allow_self_actions is 'When true, people may review/test/approve their own snapshots (solo demos).';
insert into public.app_settings default values;

create table public.procedures (
  id                 uuid primary key default gen_random_uuid(),
  name               extensions.citext not null unique check (length(name) between 3 and 120),
  description        text not null default '',
  mission            text not null default 'FF' check (mission in ('FF', 'JTYU')),
  folder             text not null default '',
  active_snapshot_id uuid,
  snapshot_seq       integer not null default 0,
  retired_at         timestamptz,
  retired_by         uuid references public.profiles (id),
  retired_reason     text,
  created_by         uuid not null references public.profiles (id),
  created_at         timestamptz not null default now()
);
comment on column public.procedures.active_snapshot_id is 'The approved snapshot (5a). Maintained only by the lifecycle functions.';
comment on column public.procedures.snapshot_seq is 'Last per-procedure snapshot number handed out (#1, #2, ...).';

create table public.snapshots (
  id                        uuid primary key default gen_random_uuid(),
  procedure_id              uuid not null references public.procedures (id) on delete cascade,
  number                    integer not null,
  author_id                 uuid not null references public.profiles (id),
  parent_snapshot_id        uuid references public.snapshots (id),
  state                     public.snapshot_state not null default 'in_progress',
  draft_path                text not null,
  code_path                 text,
  code_sha256               text check (code_sha256 ~ '^[0-9a-f]{64}$'),
  code_bytes                integer,
  entrypoint                text,
  signature                 jsonb,
  summary                   text,
  submitted_at              timestamptz,
  superseded_by_snapshot_id uuid references public.snapshots (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (procedure_id, number),
  constraint frozen_has_code check (state = 'in_progress' or (code_path is not null and code_sha256 is not null))
);
comment on column public.snapshots.draft_path is 'Storage key of the editable working copy (only written while in_progress).';
comment on column public.snapshots.code_path is 'Storage key of the frozen, immutable code (set on submit; contains the sha256).';
comment on column public.snapshots.signature is 'Entry-function arguments and types, captured when frozen.';

alter table public.procedures
  add constraint procedures_active_snapshot_fk foreign key (active_snapshot_id) references public.snapshots (id);

-- The one-approved-snapshot rule, enforced by the database itself.
create unique index one_approved_per_procedure on public.snapshots (procedure_id) where state = 'approved';

create table public.state_transitions (
  id                  bigint generated always as identity primary key,
  snapshot_id         uuid not null references public.snapshots (id) on delete cascade,
  procedure_id        uuid not null references public.procedures (id) on delete cascade,
  action              public.snapshot_action not null,
  from_state          public.snapshot_state,
  to_state            public.snapshot_state not null,
  actor_id            uuid not null references public.profiles (id),
  comment             text,
  related_snapshot_id uuid references public.snapshots (id),
  evidence            jsonb not null default '{}',
  created_at          timestamptz not null default now()
);
comment on table public.state_transitions is 'Append-only audit of every snapshot state change (PRD-001 R8).';
comment on column public.state_transitions.related_snapshot_id is 'For supersede: the snapshot that took over. For reactivate: the snapshot that was active before.';

create table public.procedure_events (
  id           bigint generated always as identity primary key,
  procedure_id uuid not null references public.procedures (id) on delete cascade,
  kind         public.procedure_event_kind not null,
  actor_id     uuid not null references public.profiles (id),
  reason       text,
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
comment on table public.procedure_events is 'Append-only audit of procedure-level events (create, retire, restore).';

create table public.review_comments (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) default auth.uid(),
  line        integer check (line > 0),
  body        text not null check (length(body) > 0),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
comment on column public.review_comments.line is 'Line in the frozen snapshot (null = general comment). Stable because snapshots never change.';

create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  snapshot_id    uuid not null references public.snapshots (id) on delete cascade,
  target         public.run_target not null default 'mock',
  code_sha256    text,
  args           jsonb not null default '{}',
  options        jsonb not null default '{}',
  outcome        public.run_outcome not null default 'running',
  error          text,
  events         jsonb not null default '[]',
  summary        jsonb not null default '{}',
  bifrost_sim_id text,
  started_by     uuid not null references public.profiles (id) default auth.uid(),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);
comment on table public.runs is 'Dry runs (mock spacecraft or Bifrost). Testers attach them as evidence.';

create table public.test_records (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  tester_id   uuid not null references public.profiles (id) default auth.uid(),
  name        text not null check (length(name) > 0),
  result      public.test_result not null,
  notes       text not null default '',
  run_id      uuid references public.runs (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index snapshots_procedure_idx on public.snapshots (procedure_id, number desc);
create index snapshots_state_idx on public.snapshots (state);
create index snapshots_author_idx on public.snapshots (author_id);
create index snapshots_parent_idx on public.snapshots (parent_snapshot_id);
create index transitions_snapshot_idx on public.state_transitions (snapshot_id, created_at);
create index transitions_procedure_idx on public.state_transitions (procedure_id, created_at desc);
create index transitions_created_idx on public.state_transitions (created_at desc);
create index transitions_actor_idx on public.state_transitions (actor_id);
create index procedure_events_procedure_idx on public.procedure_events (procedure_id, created_at desc);
create index review_comments_snapshot_idx on public.review_comments (snapshot_id);
create index runs_snapshot_idx on public.runs (snapshot_id, started_at desc);
create index test_records_snapshot_idx on public.test_records (snapshot_id);
create index procedures_created_by_idx on public.procedures (created_by);
create index procedures_active_idx on public.procedures (active_snapshot_id);

-- ---------------------------------------------------------------------------
-- Append-only audit tables
-- ---------------------------------------------------------------------------
create function private.reject_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Only discard_working_copy may remove the 'create' row of a never-submitted working copy.
  if tg_op = 'DELETE' and current_setting('mos.discarding_working_copy', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger state_transitions_append_only before update or delete on public.state_transitions
  for each row execute function private.reject_mutation();
create trigger procedure_events_append_only before update or delete on public.procedure_events
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- Profiles from auth.users
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, display_name, initials)
  values (
    new.id,
    new.email,
    v_name,
    upper(left(regexp_replace(v_name, '[^A-Za-z ]', '', 'g'), 1)
          || coalesce(left(split_part(v_name, ' ', 2), 1), ''))
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.has_role(p_role public.mos_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and (p_role = any (roles) or 'admin' = any (roles))
  );
$$;

create function private.require_role(p_role public.mos_role) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not private.has_role(p_role) then
    raise exception 'You need the % role to do this', p_role using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function private.self_actions_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select allow_self_actions from public.app_settings), false);
$$;

create function private.log_transition(
  p_snapshot public.snapshots,
  p_action public.snapshot_action,
  p_to public.snapshot_state,
  p_actor uuid,
  p_comment text,
  p_related uuid default null,
  p_evidence jsonb default '{}'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.state_transitions
    (snapshot_id, procedure_id, action, from_state, to_state, actor_id, comment, related_snapshot_id, evidence)
  values
    (p_snapshot.id, p_snapshot.procedure_id, p_action,
     case when p_action = 'create' then null else p_snapshot.state end,
     p_to, p_actor, nullif(btrim(p_comment), ''), p_related, coalesce(p_evidence, '{}'));
$$;

create function private.new_snapshot(
  p_procedure_id uuid,
  p_author uuid,
  p_parent uuid
) returns public.snapshots
language plpgsql security definer set search_path = '' as $$
declare
  v_number integer;
  v_id uuid := gen_random_uuid();
  v_row public.snapshots;
begin
  update public.procedures set snapshot_seq = snapshot_seq + 1
  where id = p_procedure_id
  returning snapshot_seq into v_number;

  insert into public.snapshots (id, procedure_id, number, author_id, parent_snapshot_id, state, draft_path)
  values (v_id, p_procedure_id, v_number, p_author, p_parent, 'in_progress', 'drafts/' || v_id || '.py')
  returning * into v_row;

  perform private.log_transition(v_row, 'create', 'in_progress', p_author, null, p_parent);
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public API (called by the Next.js server with the user's session)
-- ---------------------------------------------------------------------------

-- Create a procedure together with its first working copy (#1).
create function public.create_procedure(
  p_name text,
  p_description text default '',
  p_mission text default 'FF',
  p_folder text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_role('author');
  v_proc public.procedures;
  v_snap public.snapshots;
begin
  insert into public.procedures (name, description, mission, folder, created_by)
  values (btrim(p_name), coalesce(p_description, ''), coalesce(p_mission, 'FF'), coalesce(p_folder, ''), v_uid)
  returning * into v_proc;

  insert into public.procedure_events (procedure_id, kind, actor_id) values (v_proc.id, 'created', v_uid);
  v_snap := private.new_snapshot(v_proc.id, v_uid, null);
  return jsonb_build_object('procedure_id', v_proc.id, 'snapshot_id', v_snap.id, 'draft_path', v_snap.draft_path);
exception
  when unique_violation then
    raise exception 'A procedure named "%" already exists', btrim(p_name) using errcode = '23505';
end;
$$;

-- Fork any snapshot (or start empty) into a new working copy owned by the caller.
create function public.create_working_copy(p_procedure_id uuid, p_parent_snapshot_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_role('author');
  v_proc public.procedures;
  v_parent public.snapshots;
  v_snap public.snapshots;
begin
  select * into v_proc from public.procedures where id = p_procedure_id for update;
  if not found then raise exception 'Procedure not found' using errcode = 'P0002'; end if;
  if v_proc.retired_at is not null then
    raise exception 'This procedure is retired. Restore it before starting new work.' using errcode = 'P0001';
  end if;

  if p_parent_snapshot_id is not null then
    select * into v_parent from public.snapshots where id = p_parent_snapshot_id;
    if not found or v_parent.procedure_id <> p_procedure_id then
      raise exception 'Parent snapshot does not belong to this procedure' using errcode = 'P0001';
    end if;
  end if;

  v_snap := private.new_snapshot(p_procedure_id, v_uid, p_parent_snapshot_id);
  return jsonb_build_object(
    'snapshot_id', v_snap.id,
    'number', v_snap.number,
    'draft_path', v_snap.draft_path,
    'parent_source_path', coalesce(v_parent.code_path, v_parent.draft_path)
  );
end;
$$;

-- Remove a working copy that was never submitted. Logged on the procedure.
create function public.discard_working_copy(p_snapshot_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_snap public.snapshots;
begin
  select * into v_snap from public.snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'Snapshot not found' using errcode = 'P0002'; end if;
  if v_snap.author_id <> v_uid then raise exception 'Only the author can discard a working copy' using errcode = '42501'; end if;
  if v_snap.state <> 'in_progress' then raise exception 'Only working copies can be discarded' using errcode = 'P0001'; end if;
  if exists (select 1 from public.snapshots where parent_snapshot_id = p_snapshot_id) then
    raise exception 'Another snapshot was forked from this one' using errcode = 'P0001';
  end if;

  insert into public.procedure_events (procedure_id, kind, actor_id, detail)
  values (v_snap.procedure_id, 'working_copy_discarded', v_uid, jsonb_build_object('number', v_snap.number));
  -- the 'create' transition row cascades with the snapshot; the discard itself is kept as a procedure event
  perform set_config('mos.discarding_working_copy', 'on', true);
  delete from public.snapshots where id = p_snapshot_id;
  perform set_config('mos.discarding_working_copy', 'off', true);
end;
$$;

-- Freeze a working copy: 1 -> 2. The server has already written the immutable object at p_code_path.
-- Optionally forks a fresh working copy so the author keeps editing (PRD goal 5).
create function public.submit_snapshot(
  p_snapshot_id uuid,
  p_summary text,
  p_code_path text,
  p_sha256 text,
  p_bytes integer,
  p_entrypoint text,
  p_signature jsonb,
  p_fork boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_role('author');
  v_snap public.snapshots;
  v_proc public.procedures;
  v_fork public.snapshots;
begin
  select * into v_snap from public.snapshots where id = p_snapshot_id;
  if not found then raise exception 'Snapshot not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procedures where id = v_snap.procedure_id for update;
  select * into v_snap from public.snapshots where id = p_snapshot_id for update;

  if v_proc.retired_at is not null then raise exception 'This procedure is retired' using errcode = 'P0001'; end if;
  if v_snap.author_id <> v_uid then raise exception 'Only the author can submit this working copy' using errcode = '42501'; end if;
  if v_snap.state <> 'in_progress' then raise exception 'Snapshot #% was already submitted', v_snap.number using errcode = 'P0001'; end if;
  if coalesce(btrim(p_summary), '') = '' then raise exception 'A change summary is required' using errcode = '22023'; end if;
  if p_code_path <> format('frozen/%s/%s-%s.py', v_snap.procedure_id, v_snap.id, p_sha256) then
    raise exception 'Unexpected frozen code path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'procedure-code' and name = p_code_path) then
    raise exception 'Frozen code object is missing' using errcode = 'P0001';
  end if;

  perform private.log_transition(v_snap, 'submit', 'ready_for_review', v_uid, p_summary);
  update public.snapshots set
    state = 'ready_for_review', code_path = p_code_path, code_sha256 = p_sha256, code_bytes = p_bytes,
    entrypoint = p_entrypoint, signature = p_signature, summary = btrim(p_summary),
    submitted_at = now(), updated_at = now()
  where id = p_snapshot_id;

  if p_fork then
    v_fork := private.new_snapshot(v_snap.procedure_id, v_uid, v_snap.id);
  end if;

  return jsonb_build_object('submitted_id', v_snap.id, 'number', v_snap.number,
                            'fork_id', v_fork.id, 'fork_number', v_fork.number, 'fork_draft_path', v_fork.draft_path);
end;
$$;

-- Every other lifecycle move. One function so the rules live in one place.
create function public.transition_snapshot(
  p_snapshot_id uuid,
  p_action public.snapshot_action,
  p_comment text default null,
  p_evidence jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_snap public.snapshots;
  v_proc public.procedures;
  v_prev public.snapshots;
  v_to public.snapshot_state;
  v_role public.mos_role;
  v_from public.snapshot_state[];
  v_needs_comment boolean := false;
  v_self_ok boolean := private.self_actions_allowed();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  select * into v_snap from public.snapshots where id = p_snapshot_id;
  if not found then raise exception 'Snapshot not found' using errcode = 'P0002'; end if;
  -- Lock the procedure first: concurrent moves on any of its snapshots serialize here (first write wins).
  select * into v_proc from public.procedures where id = v_snap.procedure_id for update;
  select * into v_snap from public.snapshots where id = p_snapshot_id for update;

  if v_proc.retired_at is not null then
    raise exception 'This procedure is retired. Restore it first.' using errcode = 'P0001';
  end if;

  case p_action
    when 'review_pass' then v_from := '{ready_for_review}'; v_to := 'test_in_progress'; v_role := 'reviewer';
    when 'review_fail' then v_from := '{ready_for_review}'; v_to := 'review_failed';    v_role := 'reviewer'; v_needs_comment := true;
    when 'test_pass'   then v_from := '{test_in_progress}'; v_to := 'approval_pending'; v_role := 'tester';
    when 'test_fail'   then v_from := '{test_in_progress}'; v_to := 'test_failed';      v_role := 'tester';   v_needs_comment := true;
    when 'retest'      then v_from := '{test_failed}';      v_to := 'test_in_progress'; v_role := 'tester';   v_needs_comment := true;
    when 'approve'     then v_from := '{approval_pending}'; v_to := 'approved';         v_role := 'approver';
    when 'refuse'      then v_from := '{approval_pending}'; v_to := 'approval_failed';  v_role := 'approver'; v_needs_comment := true;
    when 'send_back'   then v_from := '{approval_failed}';  v_to := 'test_in_progress'; v_role := 'approver'; v_needs_comment := true;
    when 'reactivate'  then v_from := '{superseded,withdrawn}'; v_to := 'approved';     v_role := 'approver'; v_needs_comment := true;
    when 'withdraw'    then v_from := '{superseded}';       v_to := 'withdrawn';        v_role := 'approver'; v_needs_comment := true;
    else
      raise exception 'Action % is not a manual transition', p_action using errcode = '22023';
  end case;

  -- Retest may also be started by the snapshot's author (PRD R5).
  if p_action = 'retest' and v_snap.author_id = v_uid then
    null;
  elsif not private.has_role(v_role) then
    raise exception 'You need the % role to %', v_role, replace(p_action::text, '_', ' ') using errcode = '42501';
  end if;

  if not (v_snap.state = any (v_from)) then
    if p_action = 'withdraw' and v_snap.state = 'approved' then
      raise exception 'The active snapshot cannot be withdrawn directly. Reactivate another approved snapshot first, then withdraw this one.'
        using errcode = 'P0001';
    end if;
    raise exception 'Snapshot #% is %, so it cannot be moved by "%"', v_snap.number, replace(v_snap.state::text, '_', ' '),
      replace(p_action::text, '_', ' ') using errcode = 'P0001';
  end if;

  if v_needs_comment and coalesce(btrim(p_comment), '') = '' then
    raise exception 'A comment is required for this action' using errcode = '22023';
  end if;

  -- Separation of duties.
  if not v_self_ok then
    if p_action in ('review_pass', 'review_fail', 'test_pass', 'test_fail', 'approve', 'refuse')
       and v_snap.author_id = v_uid then
      raise exception 'You cannot % your own snapshot', split_part(p_action::text, '_', 1) using errcode = '42501';
    end if;
    if p_action in ('approve', 'refuse') and exists (
      select 1 from public.state_transitions
      where snapshot_id = v_snap.id and action = 'review_pass' and actor_id = v_uid
    ) then
      raise exception 'You reviewed this snapshot, so someone else must approve it' using errcode = '42501';
    end if;
  end if;

  -- Becoming active: the previously active snapshot is superseded in the same transaction.
  if v_to = 'approved' then
    select * into v_prev from public.snapshots
    where procedure_id = v_snap.procedure_id and state = 'approved' and id <> v_snap.id
    for update;

    if found then
      perform private.log_transition(
        v_prev, 'supersede', 'superseded', v_uid,
        case when p_action = 'reactivate'
          then format('Rolled back: #%s reactivated in place of #%s', v_snap.number, v_prev.number)
          else format('Superseded by #%s', v_snap.number) end,
        v_snap.id);
      update public.snapshots set state = 'superseded', superseded_by_snapshot_id = v_snap.id, updated_at = now()
      where id = v_prev.id;
    end if;
  end if;

  perform private.log_transition(v_snap, p_action, v_to, v_uid, p_comment, v_prev.id, p_evidence);
  update public.snapshots set
    state = v_to,
    superseded_by_snapshot_id = case when v_to = 'approved' then null else superseded_by_snapshot_id end,
    updated_at = now()
  where id = v_snap.id;

  if v_to = 'approved' then
    update public.procedures set active_snapshot_id = v_snap.id where id = v_snap.procedure_id;
  end if;

  return jsonb_build_object('snapshot_id', v_snap.id, 'from', v_snap.state, 'to', v_to,
                            'superseded_id', v_prev.id, 'superseded_number', v_prev.number);
end;
$$;

-- Retired is a procedure-level flag (state 6). Snapshots keep their states.
create function public.set_procedure_retired(p_procedure_id uuid, p_retired boolean, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_role('approver');
  v_proc public.procedures;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into v_proc from public.procedures where id = p_procedure_id for update;
  if not found then raise exception 'Procedure not found' using errcode = 'P0002'; end if;

  if p_retired and v_proc.retired_at is null then
    update public.procedures set retired_at = now(), retired_by = v_uid, retired_reason = btrim(p_reason) where id = p_procedure_id;
    insert into public.procedure_events (procedure_id, kind, actor_id, reason, detail)
    values (p_procedure_id, 'retired', v_uid, btrim(p_reason), jsonb_build_object('active_snapshot_id', v_proc.active_snapshot_id));
  elsif not p_retired and v_proc.retired_at is not null then
    update public.procedures set retired_at = null, retired_by = null, retired_reason = null where id = p_procedure_id;
    insert into public.procedure_events (procedure_id, kind, actor_id, reason, detail)
    values (p_procedure_id, 'restored', v_uid, btrim(p_reason), jsonb_build_object('active_snapshot_id', v_proc.active_snapshot_id));
  else
    raise exception 'Procedure is already %', case when p_retired then 'retired' else 'active' end using errcode = 'P0001';
  end if;
end;
$$;

create function public.set_user_roles(p_user_id uuid, p_roles public.mos_role[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('admin');
  update public.profiles set roles = coalesce(p_roles, '{}') where id = p_user_id;
end;
$$;

create function public.set_allow_self_actions(p_allow boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role('admin');
  update public.app_settings set allow_self_actions = p_allow;
end;
$$;

-- Integrity check used by tests and the seed script.
create function public.verify_lifecycle_integrity() returns table (problem text)
language sql stable security definer set search_path = '' as $$
  select format('procedure %s points at %s which is not approved', p.name, p.active_snapshot_id)
  from public.procedures p left join public.snapshots s on s.id = p.active_snapshot_id
  where p.active_snapshot_id is not null and (s.state is distinct from 'approved' or s.procedure_id <> p.id)
  union all
  select format('procedure %s has an approved snapshot but no active pointer', p.name)
  from public.procedures p
  where p.active_snapshot_id is null and exists (select 1 from public.snapshots s where s.procedure_id = p.id and s.state = 'approved')
  union all
  select format('snapshot %s state %s does not match its last transition %s', s.id, s.state, t.to_state)
  from public.snapshots s
  join lateral (select to_state from public.state_transitions where snapshot_id = s.id order by created_at desc, id desc limit 1) t on true
  where t.to_state <> s.state;
$$;

-- Wipes all demo data (service role only; used by the seed script).
create function private.reset_demo_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  truncate public.test_records, public.runs, public.review_comments, public.state_transitions,
           public.procedure_events, public.snapshots, public.procedures restart identity cascade;
end;
$$;

create function public.reset_demo_data() returns void
language sql security definer set search_path = '' as $$ select private.reset_demo_data(); $$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker so RLS applies)
-- ---------------------------------------------------------------------------
create view public.procedure_overview with (security_invoker = true) as
select
  p.id, p.name::text as name, p.description, p.mission, p.folder, p.created_by, p.created_at,
  p.retired_at, p.retired_reason, p.snapshot_seq,
  p.active_snapshot_id,
  a.number as active_number,
  a.code_sha256 as active_sha256,
  (select max(t.created_at) from public.state_transitions t where t.snapshot_id = a.id and t.to_state = 'approved') as active_since,
  count(s.id) filter (where s.state = 'in_progress')      as working_copies,
  count(s.id) filter (where s.state = 'ready_for_review') as in_review,
  count(s.id) filter (where s.state = 'test_in_progress') as in_test,
  count(s.id) filter (where s.state = 'approval_pending') as awaiting_approval,
  count(s.id)                                             as total_snapshots,
  greatest(p.created_at, max(s.updated_at)) as last_activity_at
from public.procedures p
left join public.snapshots a on a.id = p.active_snapshot_id
left join public.snapshots s on s.procedure_id = p.id
group by p.id, a.id;

create view public.snapshot_list with (security_invoker = true) as
select
  s.id, s.procedure_id, p.name::text as procedure_name, p.mission, p.folder, p.retired_at as procedure_retired_at,
  s.number, s.state, s.summary, s.code_sha256, s.entrypoint, s.parent_snapshot_id,
  ps.number as parent_number,
  s.author_id, u.display_name as author_name, u.initials as author_initials, u.color as author_color,
  s.created_at, s.submitted_at, s.updated_at,
  (select max(t.created_at) from public.state_transitions t where t.snapshot_id = s.id) as state_changed_at,
  (s.id = p.active_snapshot_id) as is_active
from public.snapshots s
join public.procedures p on p.id = s.procedure_id
join public.profiles u on u.id = s.author_id
left join public.snapshots ps on ps.id = s.parent_snapshot_id;

-- ---------------------------------------------------------------------------
-- RLS: everyone signed in can read everything (transparency); writes go through functions,
-- except comments, test records and runs which have narrow insert/update policies.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.procedures enable row level security;
alter table public.snapshots enable row level security;
alter table public.state_transitions enable row level security;
alter table public.procedure_events enable row level security;
alter table public.review_comments enable row level security;
alter table public.runs enable row level security;
alter table public.test_records enable row level security;

create policy "read profiles" on public.profiles for select to authenticated using (true);
create policy "read settings" on public.app_settings for select to authenticated using (true);
create policy "read procedures" on public.procedures for select to authenticated using (true);
create policy "read snapshots" on public.snapshots for select to authenticated using (true);
create policy "read transitions" on public.state_transitions for select to authenticated using (true);
create policy "read procedure events" on public.procedure_events for select to authenticated using (true);
create policy "read comments" on public.review_comments for select to authenticated using (true);
create policy "read runs" on public.runs for select to authenticated using (true);
create policy "read test records" on public.test_records for select to authenticated using (true);

create policy "comment as yourself" on public.review_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (
    select 1 from public.snapshots s where s.id = snapshot_id and s.state <> 'in_progress'));
create policy "resolve comments" on public.review_comments for update to authenticated
  using (author_id = (select auth.uid()) or (select private.has_role('reviewer')))
  with check (author_id = (select auth.uid()) or (select private.has_role('reviewer')));

create policy "start your own runs" on public.runs for insert to authenticated
  with check (started_by = (select auth.uid()));
create policy "finish your own runs" on public.runs for update to authenticated
  using (started_by = (select auth.uid())) with check (started_by = (select auth.uid()));

create policy "testers record tests" on public.test_records for insert to authenticated
  with check (tester_id = (select auth.uid()) and (select private.has_role('tester')) and exists (
    select 1 from public.snapshots s where s.id = snapshot_id and s.state = 'test_in_progress'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema private to authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on function private.has_role(public.mos_role) to authenticated;
grant execute on all functions in schema private to service_role;

grant select on all tables in schema public to authenticated;
grant insert, update on public.review_comments, public.runs, public.test_records to authenticated;
grant all on all tables in schema public to service_role;
revoke all on all tables in schema public from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_procedure(text, text, text, text),
  public.create_working_copy(uuid, uuid),
  public.discard_working_copy(uuid),
  public.submit_snapshot(uuid, text, text, text, integer, text, jsonb, boolean),
  public.transition_snapshot(uuid, public.snapshot_action, text, jsonb),
  public.set_procedure_retired(uuid, boolean, text),
  public.set_user_roles(uuid, public.mos_role[]),
  public.set_allow_self_actions(boolean),
  public.verify_lifecycle_integrity()
to authenticated;
revoke execute on function public.reset_demo_data() from authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, only the server (secret key) reads/writes it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('procedure-code', 'procedure-code', false, 1048576, array['text/x-python', 'text/plain'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.procedures, public.snapshots, public.state_transitions, public.procedure_events, public.review_comments, public.runs;
