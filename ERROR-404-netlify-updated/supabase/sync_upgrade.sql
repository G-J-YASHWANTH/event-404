-- ERROR-404 · LIVE SYNC UPGRADE
-- Run in Supabase SQL Editor AFTER schema.sql (organizer_lockdown.sql is also fine to run). Safe to re-run.
-- You still need at least one row in public.organizers (see the last comment in organizer_lockdown.sql).
--
-- What this adds
--   * One shared event state in the database (page shown to participants, live question, timer deadline)
--   * Organizer-created PINs, organizer-enrolled participants, organizer-controlled pages / skipping
--   * Participant sessions that work from ANY device (PIN + name -> private token, no sign-up needed)
--   * Submitted answers + organizer grading that drives the leaderboard
--
-- Security model: browsers never touch the tables directly. Every read/write goes through the
-- RPC functions below. Organizer functions require an allow-listed, signed-in organizer who owns the event.

-- ---------------------------------------------------------------- organizer allow-list (same as organizer_lockdown.sql; harmless if already applied)
create table if not exists public.organizers (user_id uuid primary key references auth.users(id) on delete cascade, email text);
alter table public.organizers enable row level security;
create or replace function public.is_organizer() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organizers where user_id = auth.uid());
$$;
revoke all on function public.is_organizer() from public, anon;
grant execute on function public.is_organizer() to authenticated;

-- ---------------------------------------------------------------- schema changes
alter table public.events add column if not exists screen text not null default 'lobby';
do $$ begin
  alter table public.events add constraint events_screen_check check (screen in ('lobby','question','leaderboard'));
exception when duplicate_object then null; end $$;
alter table public.events add column if not exists deadline timestamptz;            -- when the running question ends (server clock)
alter table public.events add column if not exists paused_remaining integer;        -- seconds left while paused
alter table public.competitors add column if not exists claimed boolean not null default false; -- has a device joined as this entry?

do $$ begin
  create unique index if not exists competitors_event_lname_idx on public.competitors(event_id, lower(display_name));
exception when others then null; end $$;

create table if not exists public.competitor_secrets (
  competitor_id uuid primary key references public.competitors(id) on delete cascade,
  token uuid not null default gen_random_uuid()
);
create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  question_number integer not null check (question_number between 0 and 10),
  source_code text not null default '',
  note text not null default '',
  submitted_at timestamptz not null default now(),
  awarded_points integer not null default 0 check (awarded_points between 0 and 1000),
  unique (competitor_id, question_number)
);
create index if not exists answers_event_q_idx on public.answers(event_id, question_number);

alter table public.competitor_secrets enable row level security;
alter table public.answers enable row level security;

-- No direct table access from the browser at all; everything goes through RPCs.
revoke all on public.events, public.competitors, public.team_members, public.competitor_secrets, public.answers from anon, authenticated;

-- ---------------------------------------------------------------- internal helpers
create or replace function public._event_json(e public.events, p_with_pin boolean)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'status', e.status, 'current_question', e.current_question,
    'question_seconds', e.question_seconds, 'screen', e.screen, 'deadline', e.deadline,
    'paused_remaining', e.paused_remaining
  ) || case when p_with_pin then jsonb_build_object('pin', e.pin) else '{}'::jsonb end;
$$;

create or replace function public._owns_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.is_organizer()
     and exists(select 1 from public.events e where e.id=p_event_id and e.created_by=auth.uid());
$$;

create or replace function public._participant_ok(p_event_id uuid, p_competitor_id uuid, p_token uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.competitor_secrets s join public.competitors c on c.id=s.competitor_id
    where s.competitor_id=p_competitor_id and s.token=p_token and c.event_id=p_event_id);
$$;

create or replace function public._recalc_competitor(p_competitor_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.competitors c set
    score = coalesce((select sum(a.awarded_points) from public.answers a where a.competitor_id=c.id),0)::integer,
    solved_count = least(10,(select count(*) from public.answers a where a.competitor_id=c.id and a.question_number>=1 and a.awarded_points>0))::integer
  where c.id=p_competitor_id;
$$;

-- ---------------------------------------------------------------- organizer functions
create or replace function public.create_event(p_name text,p_pin text,p_question_seconds integer default 300)
returns setof public.events language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_organizer() then raise exception 'Organizer access only'; end if;
  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Enter an event name'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  return query insert into public.events(name,pin,question_seconds,created_by)
    values(trim(p_name),p_pin,greatest(30,least(coalesce(p_question_seconds,300),3600)),auth.uid()) returning *;
exception when unique_violation then
  raise exception 'That PIN is already in use. Choose a different PIN.';
end; $$;

create or replace function public.organizer_list_events()
returns setof public.events language sql stable security definer set search_path=public as $$
  select e.* from public.events e where e.created_by=auth.uid() and public.is_organizer() order by e.created_at desc;
$$;

create or replace function public.organizer_snapshot(p_event_id uuid, p_question integer default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ev public.events; q integer;
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  select * into ev from public.events where id=p_event_id;
  q := coalesce(p_question, ev.current_question);
  return jsonb_build_object(
    'server_now', now(),
    'event', public._event_json(ev, true),
    'competitors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'display_name',c.display_name,'kind',c.kind,'score',c.score,'solved_count',c.solved_count,'claimed',c.claimed,
        'members', coalesce((select jsonb_agg(m.member_name order by m.member_name) from public.team_members m where m.team_id=c.id),'[]'::jsonb),
        'answered', exists(select 1 from public.answers a where a.competitor_id=c.id and a.question_number=ev.current_question)
      ) order by c.score desc, c.display_name)
      from public.competitors c where c.event_id=ev.id),'[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'competitor_id',a.competitor_id,'question_number',a.question_number,
        'source_code',a.source_code,'note',a.note,'submitted_at',a.submitted_at,'awarded_points',a.awarded_points
      ) order by a.submitted_at)
      from public.answers a where a.event_id=ev.id and a.question_number=q),'[]'::jsonb)
  );
end; $$;

create or replace function public.organizer_update_event(p_event_id uuid,p_name text,p_pin text,p_question_seconds integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  if length(trim(coalesce(p_name,'')))=0 then raise exception 'Enter an event name'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4-8 digits'; end if;
  update public.events set name=trim(p_name), pin=p_pin,
    question_seconds=greatest(30,least(coalesce(p_question_seconds,300),3600))
  where id=p_event_id;
exception when unique_violation then
  raise exception 'That PIN is already in use. Choose a different PIN.';
end; $$;

create or replace function public.organizer_set_event_status(p_event_id uuid,p_status public.event_status)
returns void language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  select * into ev from public.events where id=p_event_id for update;
  if p_status='live' then
    if ev.status='live' then return; end if;
    if ev.status='paused' and ev.paused_remaining is not null then
      update public.events set status='live', deadline=now()+make_interval(secs=>ev.paused_remaining), paused_remaining=null where id=p_event_id;
    else
      update public.events set status='live',
        screen=case when ev.screen='lobby' then 'question' else ev.screen end,
        deadline=now()+make_interval(secs=>ev.question_seconds), paused_remaining=null
      where id=p_event_id;
    end if;
  elsif p_status='paused' then
    if ev.status='live' then
      update public.events set status='paused',
        paused_remaining=greatest(0,ceil(extract(epoch from (coalesce(ev.deadline,now())-now()))))::integer,
        deadline=null
      where id=p_event_id;
    end if;
  elsif p_status='ended' then
    update public.events set status='ended', deadline=null, paused_remaining=null where id=p_event_id;
  else
    update public.events set status='draft', screen='lobby', deadline=null, paused_remaining=null where id=p_event_id;
  end if;
end; $$;

-- Old 2-argument version is replaced by one that also sets the page participants see.
drop function if exists public.organizer_set_question(uuid,integer);
create or replace function public.organizer_set_question(p_event_id uuid,p_question integer,p_screen text default 'question')
returns void language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  if p_question not between 0 and 10 then raise exception 'Question number must be 0-10'; end if;
  if p_screen not in ('lobby','question','leaderboard') then raise exception 'Unknown page'; end if;
  select * into ev from public.events where id=p_event_id for update;
  update public.events set current_question=p_question, screen=p_screen,
    deadline=case when ev.status='live' then now()+make_interval(secs=>ev.question_seconds) else null end,
    paused_remaining=case when ev.status='paused' then ev.question_seconds else null end
  where id=p_event_id;
end; $$;

create or replace function public.organizer_set_screen(p_event_id uuid,p_screen text)
returns void language plpgsql security definer set search_path=public as $$
declare ev public.events;
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  if p_screen not in ('lobby','question','leaderboard') then raise exception 'Unknown page'; end if;
  select * into ev from public.events where id=p_event_id for update;
  update public.events set screen=p_screen,
    deadline=case when p_screen='question' and ev.status='live' and ev.deadline is null
                  then now()+make_interval(secs=>ev.question_seconds) else ev.deadline end
  where id=p_event_id;
end; $$;

create or replace function public.organizer_add_competitor(p_event_id uuid,p_display_name text,p_kind public.competitor_kind,p_members text[] default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_member text; v_name text;
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  v_name := trim(coalesce(p_display_name,''));
  if length(v_name)=0 or length(v_name)>60 then raise exception 'Enter a name (up to 60 characters)'; end if;
  insert into public.competitors(event_id,display_name,kind,claimed) values(p_event_id,v_name,p_kind,false) returning id into v_id;
  if p_kind='team' then
    foreach v_member in array coalesce(p_members,'{}') loop
      if length(trim(v_member))>0 then
        insert into public.team_members(team_id,member_name) values(v_id,trim(v_member)) on conflict do nothing;
      end if;
    end loop;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'A participant with that name already exists in this event.';
end; $$;

create or replace function public.organizer_remove_competitor(p_competitor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_event uuid;
begin
  select event_id into v_event from public.competitors where id=p_competitor_id;
  if v_event is null or not public._owns_event(v_event) then raise exception 'Participant not found or access denied'; end if;
  delete from public.competitors where id=p_competitor_id;
end; $$;

-- Lets a participant re-join from a different device (frees the name and invalidates the old device).
create or replace function public.organizer_release_competitor(p_competitor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_event uuid;
begin
  select event_id into v_event from public.competitors where id=p_competitor_id;
  if v_event is null or not public._owns_event(v_event) then raise exception 'Participant not found or access denied'; end if;
  delete from public.competitor_secrets where competitor_id=p_competitor_id;
  update public.competitors set claimed=false where id=p_competitor_id;
end; $$;

create or replace function public.organizer_grade_answer(p_answer_id uuid,p_points integer)
returns void language plpgsql security definer set search_path=public as $$
declare a public.answers;
begin
  select * into a from public.answers where id=p_answer_id;
  if not found or not public._owns_event(a.event_id) then raise exception 'Answer not found or access denied'; end if;
  if p_points is null or p_points not between 0 and 1000 then raise exception 'Points must be between 0 and 1000'; end if;
  update public.answers set awarded_points=p_points where id=p_answer_id;
  perform public._recalc_competitor(a.competitor_id);
end; $$;

create or replace function public.organizer_reset_event(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public._owns_event(p_event_id) then raise exception 'Event not found or access denied'; end if;
  delete from public.answers where event_id=p_event_id;
  update public.competitors set score=0, solved_count=0 where event_id=p_event_id;
  update public.events set status='draft', current_question=0, screen='lobby', deadline=null, paused_remaining=null where id=p_event_id;
end; $$;

-- ---------------------------------------------------------------- participant functions (callable by anyone with the PIN)
drop function if exists public.get_live_event_by_pin(text);
drop function if exists public.join_event(text,text,public.competitor_kind,text[]);
create or replace function public.join_event(p_pin text,p_display_name text,p_kind public.competitor_kind,p_members text[] default '{}')
returns table(out_event_id uuid, out_competitor_id uuid, out_token uuid)
language plpgsql security definer set search_path=public as $$
declare v_event public.events; v_c public.competitors; v_id uuid; v_token uuid; v_name text; v_member text;
begin
  v_name := trim(coalesce(p_display_name,''));
  if length(v_name)=0 or length(v_name)>60 then raise exception 'Enter a name (up to 60 characters)'; end if;
  select * into v_event from public.events ev where ev.pin=p_pin and ev.status<>'ended' limit 1;
  if not found then raise exception 'Event PIN is invalid or the event has ended'; end if;

  select * into v_c from public.competitors c where c.event_id=v_event.id and lower(c.display_name)=lower(v_name) for update;
  if found then
    if v_c.claimed then
      raise exception 'That name is already taken. Pick another, or ask the organizer to release it.';
    end if;
    update public.competitors set claimed=true where id=v_c.id;   -- organizer pre-enrolled this entry: claim it
    v_id := v_c.id;
  else
    insert into public.competitors(event_id,display_name,kind,claimed,auth_user_id)
      values(v_event.id,v_name,p_kind,true,auth.uid()) returning id into v_id;
    if p_kind='team' then
      foreach v_member in array coalesce(p_members,'{}') loop
        if length(trim(v_member))>0 then
          insert into public.team_members(team_id,member_name) values(v_id,trim(v_member)) on conflict do nothing;
        end if;
      end loop;
    end if;
  end if;

  insert into public.competitor_secrets(competitor_id) values(v_id)
    on conflict (competitor_id) do update set token=gen_random_uuid()
    returning competitor_secrets.token into v_token;
  return query select v_event.id, v_id, v_token;
end; $$;

create or replace function public.participant_view(p_event_id uuid,p_competitor_id uuid,p_token uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ev public.events; me public.competitors; show_board boolean; v_answer jsonb;
begin
  if not public._participant_ok(p_event_id,p_competitor_id,p_token) then raise exception 'SESSION_INVALID'; end if;
  select * into ev from public.events where id=p_event_id;
  select * into me from public.competitors where id=p_competitor_id;
  show_board := (ev.screen='leaderboard' or ev.status='ended');
  select jsonb_build_object('source_code',a.source_code,'note',a.note,'submitted_at',a.submitted_at)
    into v_answer from public.answers a where a.competitor_id=me.id and a.question_number=ev.current_question;
  return jsonb_build_object(
    'server_now', now(),
    'event', public._event_json(ev,false),
    'me', jsonb_build_object('id',me.id,'display_name',me.display_name,'kind',me.kind,'score',me.score,'solved_count',me.solved_count),
    'my_answer', v_answer,
    'leaderboard', case when show_board then coalesce((
        select jsonb_agg(jsonb_build_object('id',x.id,'display_name',x.display_name,'kind',x.kind,'score',x.score,'solved_count',x.solved_count)
                         order by x.score desc, x.display_name)
        from public.competitors x where x.event_id=ev.id),'[]'::jsonb)
      else '[]'::jsonb end
  );
end; $$;

create or replace function public.submit_answer(p_event_id uuid,p_competitor_id uuid,p_token uuid,p_question integer,p_code text,p_note text default '')
returns timestamptz language plpgsql security definer set search_path=public as $$
declare ev public.events; v_ts timestamptz;
begin
  if not public._participant_ok(p_event_id,p_competitor_id,p_token) then raise exception 'SESSION_INVALID'; end if;
  select * into ev from public.events where id=p_event_id;
  if ev.status<>'live' then raise exception 'The event is not live right now'; end if;
  if ev.screen<>'question' or ev.current_question<>p_question then raise exception 'This question is no longer open'; end if;
  if ev.deadline is not null and now()>ev.deadline+interval '3 seconds' then raise exception 'Time is up for this question'; end if;
  if length(coalesce(p_code,''))>20000 or length(coalesce(p_note,''))>5000 then raise exception 'Submission is too large'; end if;
  insert into public.answers(event_id,competitor_id,question_number,source_code,note)
    values(p_event_id,p_competitor_id,p_question,coalesce(p_code,''),coalesce(p_note,''))
  on conflict (competitor_id,question_number) do update
    set source_code=excluded.source_code, note=excluded.note, submitted_at=now()
    where public.answers.awarded_points=0
  returning submitted_at into v_ts;
  if v_ts is null then raise exception 'Your answer was already graded and can no longer be changed'; end if;
  return v_ts;
end; $$;

-- ---------------------------------------------------------------- permissions
revoke all on function public._event_json(public.events,boolean) from public, anon, authenticated;
revoke all on function public._owns_event(uuid) from public, anon, authenticated;
revoke all on function public._participant_ok(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public._recalc_competitor(uuid) from public, anon, authenticated;

revoke all on function public.create_event(text,text,integer) from public, anon, authenticated;
revoke all on function public.organizer_list_events() from public, anon, authenticated;
revoke all on function public.organizer_snapshot(uuid,integer) from public, anon, authenticated;
revoke all on function public.organizer_update_event(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.organizer_set_event_status(uuid,public.event_status) from public, anon, authenticated;
revoke all on function public.organizer_set_question(uuid,integer,text) from public, anon, authenticated;
revoke all on function public.organizer_set_screen(uuid,text) from public, anon, authenticated;
revoke all on function public.organizer_add_competitor(uuid,text,public.competitor_kind,text[]) from public, anon, authenticated;
revoke all on function public.organizer_remove_competitor(uuid) from public, anon, authenticated;
revoke all on function public.organizer_release_competitor(uuid) from public, anon, authenticated;
revoke all on function public.organizer_grade_answer(uuid,integer) from public, anon, authenticated;
revoke all on function public.organizer_reset_event(uuid) from public, anon, authenticated;
grant execute on function public.create_event(text,text,integer) to authenticated;
grant execute on function public.organizer_list_events() to authenticated;
grant execute on function public.organizer_snapshot(uuid,integer) to authenticated;
grant execute on function public.organizer_update_event(uuid,text,text,integer) to authenticated;
grant execute on function public.organizer_set_event_status(uuid,public.event_status) to authenticated;
grant execute on function public.organizer_set_question(uuid,integer,text) to authenticated;
grant execute on function public.organizer_set_screen(uuid,text) to authenticated;
grant execute on function public.organizer_add_competitor(uuid,text,public.competitor_kind,text[]) to authenticated;
grant execute on function public.organizer_remove_competitor(uuid) to authenticated;
grant execute on function public.organizer_release_competitor(uuid) to authenticated;
grant execute on function public.organizer_grade_answer(uuid,integer) to authenticated;
grant execute on function public.organizer_reset_event(uuid) to authenticated;

revoke all on function public.join_event(text,text,public.competitor_kind,text[]) from public, anon, authenticated;
revoke all on function public.participant_view(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.submit_answer(uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.join_event(text,text,public.competitor_kind,text[]) to anon, authenticated;
grant execute on function public.participant_view(uuid,uuid,uuid) to anon, authenticated;
grant execute on function public.submit_answer(uuid,uuid,uuid,integer,text,text) to anon, authenticated;

-- Make PostgREST pick up the new/changed functions immediately.
notify pgrst, 'reload schema';
