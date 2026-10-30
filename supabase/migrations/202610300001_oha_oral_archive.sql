-- Omani Historical Association — oral history archive. Dedicated objects only.
-- Run on a NEW, dedicated Supabase project; never publish raw private tables.
create table if not exists public.oha_oral_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'reviewer' check (role in ('reviewer','admin')),
  added_at timestamptz not null default now()
);
create table if not exists public.oha_oral_stories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 4 and 160),
  narrator text not null default 'راوٍ عُماني',
  contact text, recorded_by text,
  governorate text not null, wilayah text not null,
  village text, category text not null, era text,
  story_source text not null default 'witness' check (story_source in ('witness','heard')),
  summary text not null default '', transcript text not null default '',
  audio_path text, audio_mime text, duration_seconds integer not null default 0,
  attachment_path text, attachment_mime text,
  consent_storage boolean not null check (consent_storage),
  consent_public boolean not null default false,
  consent_name boolean not null default false,
  consent_audio boolean not null default false,
  consent_attachment boolean not null default false,
  authority_confirmed boolean not null default false,
  status text not null default 'pending' check (status in ('pending','needs_info','approved','rejected','private_archived')),
  review_note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint oha_public_approval_has_consent check (status <> 'approved' or consent_public),
  constraint oha_some_content check (audio_path is not null or char_length(trim(transcript)) >= 20 or char_length(trim(summary)) >= 20)
);
create index if not exists oha_oral_stories_status_idx on public.oha_oral_stories(status,created_at desc);
create table if not exists public.oha_oral_review_logs (
  id bigint generated always as identity primary key,
  story_id uuid not null references public.oha_oral_stories(id) on delete cascade,
  reviewer_id uuid,
  previous_status text, new_status text,
  change_note text,
  changed_at timestamptz not null default now()
);
create table if not exists public.oha_oral_submission_limits (
  id bigint generated always as identity primary key,
  ip_digest text not null,
  created_at timestamptz not null default now()
);
create index if not exists oha_oral_limits_ip_idx on public.oha_oral_submission_limits(ip_digest,created_at desc);

alter table public.oha_oral_reviewers enable row level security;
alter table public.oha_oral_stories enable row level security;
alter table public.oha_oral_review_logs enable row level security;
alter table public.oha_oral_submission_limits enable row level security;

-- Permissions remain narrow even if Data API grants are customized.
revoke all on public.oha_oral_reviewers, public.oha_oral_stories, public.oha_oral_review_logs, public.oha_oral_submission_limits from anon, authenticated;
grant select on public.oha_oral_reviewers to authenticated;
grant select on public.oha_oral_stories to authenticated;
grant update (title,category,summary,transcript,status,review_note) on public.oha_oral_stories to authenticated;
grant select on public.oha_oral_review_logs to authenticated;

create policy "oha reviewer self read" on public.oha_oral_reviewers for select to authenticated
  using (user_id=(select auth.uid()));
create policy "oha reviewers read private stories" on public.oha_oral_stories for select to authenticated
  using (exists(select 1 from public.oha_oral_reviewers r where r.user_id=(select auth.uid())));
create policy "oha reviewers edit reviewed fields" on public.oha_oral_stories for update to authenticated
  using (exists(select 1 from public.oha_oral_reviewers r where r.user_id=(select auth.uid())))
  with check (exists(select 1 from public.oha_oral_reviewers r where r.user_id=(select auth.uid())) and (status <> 'approved' or consent_public));
create policy "oha reviewers read history" on public.oha_oral_review_logs for select to authenticated
  using (exists(select 1 from public.oha_oral_reviewers r where r.user_id=(select auth.uid())));

-- A protected, internal trigger records ALL reviewer updates, not relying on the UI.
create schema if not exists oha_internal;
create or replace function oha_internal.audit_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at=now();
  insert into public.oha_oral_review_logs(story_id,reviewer_id,previous_status,new_status,change_note)
    values(new.id,auth.uid(),old.status,new.status,new.review_note);
  return new;
end $$;
revoke all on function oha_internal.audit_review() from public, anon, authenticated;
drop trigger if exists oha_oral_audit on public.oha_oral_stories;
create trigger oha_oral_audit before update on public.oha_oral_stories
 for each row execute function oha_internal.audit_review();

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('oha-oral-private','oha-oral-private',false,15728640,
 array['audio/mp4','video/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/webm','video/webm','audio/ogg','application/ogg','image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;
-- Intentionally NO public storage.objects policies: only service-role backend may sign/read/upload.
-- First reviewer: create the Auth user in Supabase Authentication, then manually run:
-- insert into public.oha_oral_reviewers(user_id,role) values ('<AUTH_USER_UUID>','admin');
