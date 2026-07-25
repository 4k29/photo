-- Travel Ticket MVP
-- Supabase SQL Editorでこのファイル全体を実行してください。

create extension if not exists pgcrypto;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  origin text not null check (char_length(origin) between 1 and 40),
  destination text not null check (char_length(destination) between 1 and 40),
  starts_on date not null,
  ends_on date not null,
  traveler_names text[] not null default '{}',
  slug text not null unique check (char_length(slug) between 12 and 80),
  visibility text not null default 'unlisted' check (visibility in ('private', 'unlisted', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_trip_dates check (ends_on >= starts_on)
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_name text,
  taken_at timestamptz not null,
  taken_on date not null,
  created_at timestamptz not null default now()
);

create index if not exists trips_owner_id_idx on public.trips(owner_id);
create index if not exists trips_slug_idx on public.trips(slug);
create index if not exists photos_trip_taken_idx on public.photos(trip_id, taken_at);
create index if not exists photos_trip_day_idx on public.photos(trip_id, taken_on);

alter table public.trips enable row level security;
alter table public.photos enable row level security;

create policy "Owners and visitors can read visible trips"
on public.trips for select
using (auth.uid() = owner_id or visibility in ('unlisted', 'public'));

create policy "Owners can create trips"
on public.trips for insert
to authenticated
with check (auth.uid() = owner_id);

create policy "Owners can update trips"
on public.trips for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Owners can delete trips"
on public.trips for delete
to authenticated
using (auth.uid() = owner_id);

create policy "Owners and visitors can read visible photos"
on public.photos for select
using (
  auth.uid() = owner_id
  or exists (
    select 1 from public.trips
    where trips.id = photos.trip_id
      and trips.visibility in ('unlisted', 'public')
  )
);

create policy "Owners can add photos"
on public.photos for insert
to authenticated
with check (
  auth.uid() = owner_id
  and exists (
    select 1 from public.trips
    where trips.id = photos.trip_id and trips.owner_id = auth.uid()
  )
);

create policy "Owners can update photos"
on public.photos for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "Owners can delete photos"
on public.photos for delete
to authenticated
using (auth.uid() = owner_id);

-- UIだけでなくDBでも、1旅行・1日あたり9枚を超えないようにする。
create or replace function public.enforce_daily_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.trip_id::text || ':' || new.taken_on::text));

  select count(*)
    into current_count
  from public.photos
  where trip_id = new.trip_id
    and taken_on = new.taken_on
    and id <> new.id;

  if current_count >= 9 then
    raise exception '1日につき写真は9枚までです';
  end if;

  return new;
end;
$$;

drop trigger if exists photos_daily_limit on public.photos;
create trigger photos_daily_limit
before insert or update of trip_id, taken_on on public.photos
for each row execute function public.enforce_daily_photo_limit();

-- 写真は非公開バケットに保存し、表示時だけ期限付きURLを発行する。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-photos',
  'trip-photos',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Visitors can view visible trip photos"
on storage.objects for select
using (
  bucket_id = 'trip-photos'
  and (
    auth.uid()::text = (storage.foldername(name))[2]
    or exists (
      select 1 from public.trips
      where trips.id::text = (storage.foldername(name))[1]
        and trips.visibility in ('unlisted', 'public')
    )
  )
);

create policy "Owners can upload trip photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'trip-photos'
  and auth.uid()::text = (storage.foldername(name))[2]
  and exists (
    select 1 from public.trips
    where trips.id::text = (storage.foldername(name))[1]
      and trips.owner_id = auth.uid()
  )
);

create policy "Owners can delete trip photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'trip-photos'
  and auth.uid()::text = (storage.foldername(name))[2]
);
