-- ذاكرة عُمان الصوتية — مخطط قاعدة البيانات في Supabase
-- الجمعية التاريخية العُمانية
--
-- طريقة التشغيل: إن كان ربط GitHub في Supabase مفعّلاً مع «Deploy to production» يُطبَّق الملف تلقائياً.
-- وإلا: Supabase Dashboard ← SQL Editor ← New query ← الصق الملف كاملاً ← Run
-- الملف آمن للتشغيل أكثر من مرة.
--
-- الفكرة:
--   * الزائر يرفع التسجيل إلى مجلد pending/ في حاوية oral-audio (حاوية خاصة، غير عامة).
--   * ثم يستدعي الدالة submit_story التي تتحقق من الموافقات وتحفظ الرواية بحالة «بانتظار المراجعة».
--   * بيانات الراوي الكاملة وموافقته تُحفظ في جدول خاص (story_consents) لا يقرؤه إلا المشرفون.
--   * لا تظهر الرواية ولا صوتها للناس إلا بعد أن يعتمدها مشرف.

-- ============================================================
-- 1) الجداول
-- ============================================================

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);

create table if not exists public.stories (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  title            text not null check (char_length(title) between 3 and 140),
  narrator_display text not null check (char_length(narrator_display) between 2 and 120),
  narrator_age     int  check (narrator_age between 1 and 130),   -- يُحفظ هنا فقط إذا وافق الراوي على إظهار عمره
  governorate      text not null check (governorate in (
                     'مسقط','ظفار','مسندم','البريمي','الداخلية','شمال الباطنة',
                     'جنوب الباطنة','جنوب الشرقية','شمال الشرقية','الظاهرة','الوسطى')),
  wilayah          text check (char_length(wilayah) <= 80),
  topic            text not null check (topic in (
                     'الأفلاج والزراعة','البحر والصيد','الأسواق والتجارة','الحرف والمهن',
                     'الأعراس والمناسبات','السفر والقوافل','الكتاتيب والتعليم','الحياة اليومية')),
  transcript       text check (char_length(transcript) <= 20000),
  recorded_by      text check (char_length(recorded_by) <= 120),
  audio_path       text not null unique check (audio_path ~ '^pending/[0-9a-f-]{36}\.(m4a|mp3|wav|webm|ogg|aac|mp4)$'),
  audio_type       text check (char_length(audio_type) <= 60),
  duration_sec     int  check (duration_sec between 0 and 14400),
  reviewed_at      timestamptz,
  reviewed_by      uuid references auth.users(id),
  review_note      text
);

create index if not exists stories_status_created_idx on public.stories (status, created_at desc);

-- بيانات الموافقة: خاصة، لا يقرؤها إلا المشرفون
create table if not exists public.story_consents (
  story_id                   uuid primary key references public.stories(id) on delete cascade,
  created_at                 timestamptz not null default now(),
  narrator_full_name         text not null check (char_length(narrator_full_name) between 2 and 120),
  narrator_age               int  check (narrator_age between 1 and 130),
  governorate                text not null,
  wilayah                    text,
  consent_record             boolean not null check (consent_record),          -- وافق على التسجيل
  consent_publish_audio      boolean not null check (consent_publish_audio),   -- وافق على نشر صوته
  consent_publish_transcript boolean not null,                                  -- وافق على نشر النص المكتوب
  consent_show_name          boolean not null,                                  -- وافق على إظهار اسمه
  consent_show_age           boolean not null,                                  -- وافق على إظهار عمره
  consent_education_use      boolean not null,                                  -- وافق على الاستخدام في التعليم والبحث
  signed_by                  text not null check (char_length(signed_by) between 2 and 120),
  signer_relation            text not null check (signer_relation in ('الراوي نفسه','أحد أفراد أسرته بإذنه','وكيل بإذنه')),
  contact                    text check (char_length(contact) <= 120),          -- رقم أو بريد للتواصل، اختياري
  consent_version            text not null
);

-- ============================================================
-- 2) دالة المشرف
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ============================================================
-- 3) صلاحيات الجداول (Row Level Security)
-- ============================================================

alter table public.admins         enable row level security;
alter table public.stories        enable row level security;
alter table public.story_consents enable row level security;

-- الجمهور: يقرأ الروايات المعتمدة فقط
drop policy if exists "public reads approved stories" on public.stories;
create policy "public reads approved stories" on public.stories
  for select to anon, authenticated
  using (status = 'approved');

-- المشرفون: يقرؤون ويعدّلون ويحذفون كل الروايات
drop policy if exists "admins read all stories" on public.stories;
create policy "admins read all stories" on public.stories
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update stories" on public.stories;
create policy "admins update stories" on public.stories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete stories" on public.stories;
create policy "admins delete stories" on public.stories
  for delete to authenticated using (public.is_admin());

-- الموافقات: للمشرفين فقط
drop policy if exists "admins read consents" on public.story_consents;
create policy "admins read consents" on public.story_consents
  for select to authenticated using (public.is_admin());

-- المشرف يرى سطره في جدول المشرفين (لتعرف الصفحة أنه مشرف)
drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- لا إدراج مباشر في الجداول من المتصفح؛ الإرسال يمر عبر submit_story فقط
revoke insert, update, delete on public.stories        from anon, authenticated;
revoke insert, update, delete on public.story_consents from anon, authenticated;
revoke insert, update, delete on public.admins         from anon, authenticated;
grant  select on public.stories to anon, authenticated;
grant  update (status, reviewed_at, reviewed_by, review_note) on public.stories to authenticated;
grant  delete on public.stories to authenticated;
grant  select on public.story_consents to authenticated;
grant  select on public.admins to authenticated;

-- ============================================================
-- 4) دالة إرسال رواية (تُستدعى من صفحة الأرشيف)
-- ============================================================

create or replace function public.submit_story(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_path  text := p->>'audio_path';
  v_show_name boolean := coalesce((p->>'consent_show_name')::boolean, false);
  v_show_age  boolean := coalesce((p->>'consent_show_age')::boolean, false);
  v_publish_tx boolean := coalesce((p->>'consent_publish_transcript')::boolean, false);
  v_age   int := nullif(p->>'narrator_age','')::int;
  v_display text;
begin
  if coalesce((p->>'consent_record')::boolean, false) is not true
     or coalesce((p->>'consent_publish_audio')::boolean, false) is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  -- يجب أن يكون الملف قد رُفع فعلاً إلى مجلد الانتظار
  if v_path is null or not exists (
       select 1 from storage.objects o where o.bucket_id = 'oral-audio' and o.name = v_path) then
    raise exception 'audio_missing' using errcode = '22023';
  end if;

  -- اسم العرض: الاسم إن وافق، وإلا «راوٍ من الولاية»
  v_display := case when v_show_name then btrim(p->>'narrator_full_name')
                    else 'راوٍ من ' || coalesce(nullif(btrim(p->>'wilayah'),''), p->>'governorate') end;

  insert into public.stories (title, narrator_display, narrator_age, governorate, wilayah, topic,
                              transcript, recorded_by, audio_path, audio_type, duration_sec)
  values (btrim(p->>'title'),
          v_display,
          case when v_show_age then v_age end,
          p->>'governorate',
          nullif(btrim(p->>'wilayah'),''),
          p->>'topic',
          case when v_publish_tx then nullif(btrim(p->>'transcript'),'') end,
          nullif(btrim(p->>'recorded_by'),''),
          v_path,
          left(p->>'audio_type', 60),
          nullif(p->>'duration_sec','')::int)
  returning id into v_id;

  insert into public.story_consents (story_id, narrator_full_name, narrator_age, governorate, wilayah,
         consent_record, consent_publish_audio, consent_publish_transcript, consent_show_name,
         consent_show_age, consent_education_use, signed_by, signer_relation, contact, consent_version)
  values (v_id, btrim(p->>'narrator_full_name'), v_age, p->>'governorate', nullif(btrim(p->>'wilayah'),''),
          true, true, v_publish_tx, v_show_name, v_show_age,
          coalesce((p->>'consent_education_use')::boolean, false),
          btrim(p->>'signed_by'), p->>'signer_relation', nullif(btrim(p->>'contact'),''),
          coalesce(p->>'consent_version','1'));

  return v_id;
end;
$$;

revoke all on function public.submit_story(jsonb) from public;
grant execute on function public.submit_story(jsonb) to anon, authenticated;

-- عند الاعتماد أو الرفض يُسجَّل المراجع ووقت المراجعة تلقائياً
create or replace function public.stamp_review()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists stories_stamp_review on public.stories;
create trigger stories_stamp_review before update on public.stories
  for each row execute function public.stamp_review();

-- ============================================================
-- 5) حاوية التسجيلات الصوتية وصلاحياتها
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('oral-audio', 'oral-audio', false, 26214400,  -- 25 ميجابايت
        array['audio/mp4','audio/x-m4a','audio/m4a','audio/mpeg','audio/mp3','audio/wav','audio/x-wav',
              'audio/webm','audio/ogg','audio/aac','video/mp4','video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- الزائر يرفع إلى مجلد الانتظار فقط
drop policy if exists "oral audio: upload to pending" on storage.objects;
create policy "oral audio: upload to pending" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'oral-audio' and (storage.foldername(name))[1] = 'pending');

-- الجمهور يستمع إلى تسجيلات الروايات المعتمدة فقط
drop policy if exists "oral audio: read approved" on storage.objects;
create policy "oral audio: read approved" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'oral-audio' and exists (
           select 1 from public.stories s where s.audio_path = storage.objects.name and s.status = 'approved'));

-- المشرفون يستمعون إلى كل التسجيلات ويحذفونها
drop policy if exists "oral audio: admins read" on storage.objects;
create policy "oral audio: admins read" on storage.objects
  for select to authenticated using (bucket_id = 'oral-audio' and public.is_admin());

drop policy if exists "oral audio: admins delete" on storage.objects;
create policy "oral audio: admins delete" on storage.objects
  for delete to authenticated using (bucket_id = 'oral-audio' and public.is_admin());

-- ============================================================
-- 6) إضافة مشرف (شغّليه بعد إنشاء حساب المشرف من Authentication ← Users)
-- ============================================================
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict do nothing;
