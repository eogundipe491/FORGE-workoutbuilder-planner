-- FORGE core schema. Run in Supabase SQL Editor or through Supabase migrations.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  role text not null default 'athlete' check (role in ('athlete','trainer','admin')),
  nutrition_enabled boolean not null default false,
  onboarding_skipped boolean not null default false,
  preferred_weight_unit text not null default 'kg' check (preferred_weight_unit in ('kg','lb')),
  preferred_distance_unit text not null default 'km' check (preferred_distance_unit in ('km','mi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'first_name',''), coalesce(new.raw_user_meta_data->>'last_name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create table if not exists public.onboarding_responses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  muscle_group text not null default 'Full body',
  equipment text not null default 'Not specified',
  movement_pattern text not null default 'Other',
  category text not null default 'Exercise',
  description text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists exercises_name_idx on public.exercises using gin (to_tsvector('english', name || ' ' || muscle_group || ' ' || equipment || ' ' || description));

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text not null default '',
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workouts_user_updated_idx on public.workouts(user_id, updated_at desc);

create table if not exists public.programmes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  plan_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid references public.workouts(id) on delete set null,
  workout_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  exercises jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_started_idx on public.workout_sessions(user_id, started_at desc);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text not null default '',
  logged_at timestamptz not null default now()
);

create table if not exists public.trainer_clients (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  created_at timestamptz not null default now(),
  unique (trainer_id, client_id),
  check (trainer_id <> client_id)
);

create table if not exists public.trainer_notes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.onboarding_responses enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.programmes enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.meals enable row level security;
alter table public.trainer_clients enable row level security;
alter table public.trainer_notes enable row level security;

-- Profiles: users can read and update only their own profile. Role changes are not exposed to clients.
drop policy if exists "profile_select_own" on public.profiles;
create policy "profile_select_own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profile_update_own" on public.profiles;
create policy "profile_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Questionnaire data is private to its owner.
drop policy if exists "onboarding_owner_all" on public.onboarding_responses;
create policy "onboarding_owner_all" on public.onboarding_responses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Catalogue rows without an owner are shared; custom exercises are owner-only.
drop policy if exists "exercise_read_catalogue_and_own" on public.exercises;
create policy "exercise_read_catalogue_and_own" on public.exercises for select to anon, authenticated using (user_id is null or user_id = auth.uid());
drop policy if exists "exercise_insert_own" on public.exercises;
create policy "exercise_insert_own" on public.exercises for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "exercise_update_own" on public.exercises;
create policy "exercise_update_own" on public.exercises for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "exercise_delete_own" on public.exercises;
create policy "exercise_delete_own" on public.exercises for delete to authenticated using (user_id = auth.uid());

-- User-owned records.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workouts','programmes','workout_sessions','meals'] LOOP
    EXECUTE format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    EXECUTE format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_owner_all', t);
  END LOOP;
END $$;

-- Trainer relationships: only either participant can view the relationship.
drop policy if exists "trainer_client_participant_select" on public.trainer_clients;
create policy "trainer_client_participant_select" on public.trainer_clients for select to authenticated using (trainer_id = auth.uid() or client_id = auth.uid());
drop policy if exists "trainer_client_client_request" on public.trainer_clients;
create policy "trainer_client_client_request" on public.trainer_clients for insert to authenticated with check (client_id = auth.uid());
drop policy if exists "trainer_client_trainer_update" on public.trainer_clients;
create policy "trainer_client_trainer_update" on public.trainer_clients for update to authenticated using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());
drop policy if exists "trainer_notes_participant_select" on public.trainer_notes;
create policy "trainer_notes_participant_select" on public.trainer_notes for select to authenticated using (
  trainer_id = auth.uid() or (client_id = auth.uid() and exists(select 1 from public.trainer_clients tc where tc.trainer_id = trainer_notes.trainer_id and tc.client_id = auth.uid() and tc.status = 'active'))
);
drop policy if exists "trainer_notes_trainer_write" on public.trainer_notes;
create policy "trainer_notes_trainer_write" on public.trainer_notes for all to authenticated using (
  trainer_id = auth.uid() and exists(select 1 from public.trainer_clients tc where tc.trainer_id = auth.uid() and tc.client_id = trainer_notes.client_id and tc.status = 'active')
) with check (
  trainer_id = auth.uid() and exists(select 1 from public.trainer_clients tc where tc.trainer_id = auth.uid() and tc.client_id = trainer_notes.client_id and tc.status = 'active')
);

-- Prevent duplicate shared seed entries when this migration is re-applied.
create unique index if not exists exercises_shared_name_unique on public.exercises (lower(name)) where user_id is null;

-- Prevent users from promoting their own role through profile updates.
create or replace function public.prevent_role_escalation() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role and current_user not in ('postgres','service_role') and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Role changes must be performed by an authorised administrator.';
  end if;
  return new;
end;
$$;
drop trigger if exists prevent_profile_role_escalation on public.profiles;
create trigger prevent_profile_role_escalation before update on public.profiles for each row execute procedure public.prevent_role_escalation();

-- Seed a useful shared catalogue. Add to this dataset over time; users can create private custom entries.
insert into public.exercises (user_id,name,muscle_group,equipment,movement_pattern,category,description,instructions) values
(null,'Barbell Back Squat','Legs','Barbell','Squat','Compound','A squat variation using a barbell across the upper back.','Brace comfortably, keep a stable stance and squat through a controlled range that suits your mobility.'),
(null,'Goblet Squat','Legs','Dumbbell','Squat','Compound','A squat holding one dumbbell or kettlebell close to the chest.','Hold the load close, keep your feet stable and move with control.'),
(null,'Front Squat','Legs','Barbell','Squat','Compound','A squat with the bar supported at the front of the shoulders.','Maintain a secure rack position and controlled movement.'),
(null,'Leg Press','Legs','Machine','Squat','Compound','A machine-based lower-body press.','Set the seat and range comfortably; avoid forcing the knees into lockout.'),
(null,'Romanian Deadlift','Hamstrings','Barbell','Hinge','Compound','A hip-hinge exercise targeting the posterior chain.','Keep the load close and hinge at the hips with a controlled range.'),
(null,'Conventional Deadlift','Back','Barbell','Hinge','Compound','A floor-to-standing barbell lift.','Set up with a stable stance and lift with controlled technique.'),
(null,'Hip Thrust','Glutes','Barbell','Hip extension','Compound','A loaded hip-extension exercise.','Use a stable bench setup and avoid overextending the lower back.'),
(null,'Walking Lunge','Legs','Dumbbell','Lunge','Compound','A travelling single-leg exercise.','Take a comfortable stride and maintain balance throughout.'),
(null,'Bulgarian Split Squat','Legs','Dumbbell','Lunge','Compound','A split squat with the rear foot elevated.','Use a stable support and a range that feels controlled.'),
(null,'Leg Extension','Quadriceps','Machine','Knee extension','Isolation','A machine exercise for the quadriceps.','Adjust the pad and move smoothly without swinging.'),
(null,'Seated Leg Curl','Hamstrings','Machine','Knee flexion','Isolation','A machine-based hamstring curl.','Align the machine pivot and use a controlled tempo.'),
(null,'Standing Calf Raise','Calves','Machine','Plantar flexion','Isolation','A calf-focused raise.','Move through a comfortable ankle range without bouncing.'),
(null,'Barbell Bench Press','Chest','Barbell','Horizontal push','Compound','A horizontal pressing movement.','Use a stable setup and a range appropriate to your shoulder comfort.'),
(null,'Dumbbell Bench Press','Chest','Dumbbell','Horizontal push','Compound','A dumbbell chest press performed on a bench.','Keep wrists controlled and lower the dumbbells smoothly.'),
(null,'Incline Dumbbell Press','Chest','Dumbbell','Incline push','Compound','An angled dumbbell press.','Set a moderate bench angle and use a controlled range.'),
(null,'Push-Up','Chest','Bodyweight','Horizontal push','Compound','A bodyweight horizontal push.','Keep the trunk steady; use an incline variation if needed.'),
(null,'Chest Fly','Chest','Cable','Horizontal adduction','Isolation','A chest isolation movement using cables.','Keep a soft elbow bend and use a comfortable range.'),
(null,'Overhead Press','Shoulders','Barbell','Vertical push','Compound','A vertical barbell press.','Brace and press only through a comfortable overhead range.'),
(null,'Dumbbell Shoulder Press','Shoulders','Dumbbell','Vertical push','Compound','A seated or standing dumbbell press.','Use a stable torso and a comfortable range.'),
(null,'Lateral Raise','Shoulders','Dumbbell','Shoulder abduction','Isolation','A shoulder accessory movement.','Raise with control and avoid swinging.'),
(null,'Face Pull','Shoulders','Cable','Horizontal pull','Accessory','A cable upper-back and shoulder accessory.','Pull towards face level with elbows comfortably out.'),
(null,'Triceps Pushdown','Triceps','Cable','Elbow extension','Isolation','A cable elbow-extension exercise.','Keep upper arms steady and extend smoothly.'),
(null,'Overhead Triceps Extension','Triceps','Cable','Elbow extension','Isolation','An overhead triceps exercise.','Choose a comfortable shoulder position and control the movement.'),
(null,'Pull-Up','Back','Bodyweight','Vertical pull','Compound','A bodyweight vertical pull.','Use a secure bar and an assistance option if required.'),
(null,'Lat Pulldown','Back','Cable','Vertical pull','Compound','A cable vertical-pull exercise.','Pull towards the upper chest without leaning excessively.'),
(null,'Seated Cable Row','Back','Cable','Horizontal pull','Compound','A seated horizontal cable row.','Keep the torso steady and pull with controlled shoulder movement.'),
(null,'Barbell Bent-Over Row','Back','Barbell','Horizontal pull','Compound','A bent-over barbell row.','Hinge comfortably and keep the spine stable.'),
(null,'One-Arm Dumbbell Row','Back','Dumbbell','Horizontal pull','Compound','A unilateral dumbbell row.','Support yourself and row without twisting the torso.'),
(null,'Chest-Supported Row','Back','Machine','Horizontal pull','Compound','A supported horizontal row.','Keep the chest supported and avoid momentum.'),
(null,'Biceps Curl','Biceps','Dumbbell','Elbow flexion','Isolation','A basic dumbbell curl.','Keep elbows relatively steady and lower under control.'),
(null,'Hammer Curl','Biceps','Dumbbell','Elbow flexion','Isolation','A neutral-grip curl.','Keep wrists neutral and avoid swinging.'),
(null,'Plank','Core','Bodyweight','Anti-extension','Core','An isometric trunk stability exercise.','Maintain comfortable alignment and breathe steadily.'),
(null,'Dead Bug','Core','Bodyweight','Core stability','Core','A controlled trunk stability drill.','Move opposite arm and leg while keeping the trunk controlled.'),
(null,'Pallof Press','Core','Cable','Anti-rotation','Core','An anti-rotation cable press.','Resist rotation and use a manageable cable load.'),
(null,'Hanging Knee Raise','Core','Bodyweight','Trunk flexion','Core','A hanging trunk exercise.','Use a stable hang and avoid swinging.'),
(null,'Farmer Carry','Full body','Dumbbell','Carry','Loaded carry','A loaded carry for grip and trunk stability.','Walk with controlled steps and loads you can manage.'),
(null,'Treadmill Walk','Cardio','Treadmill','Locomotion','Cardio','A walking cardiovascular option.','Choose a comfortable pace and incline.'),
(null,'Stationary Bike','Cardio','Bike','Cycling','Cardio','A stationary cycling option.','Adjust the seat and select a sustainable resistance.'),
(null,'Rowing Machine','Cardio','Rower','Rowing','Cardio','A full-body cardiovascular machine.','Use a smooth leg-body-arm sequence and controlled return.'),
(null,'Jump Rope','Cardio','Rope','Plyometric','Cardio','A skipping exercise for coordination and conditioning.','Start with short intervals and a clear, safe space.'),
(null,'Bird Dog','Mobility','Bodyweight','Spinal stability','Mobility','A controlled quadruped stability drill.','Reach opposite limbs while keeping the trunk steady.'),
(null,'World’s Greatest Stretch','Mobility','Bodyweight','Mobility','Mobility','A multi-directional mobility sequence.','Move gently and stay within a comfortable range.'),
(null,'Glute Bridge','Glutes','Bodyweight','Hip extension','Accessory','A bodyweight hip-extension exercise.','Press through the feet and lift without arching the back.'),
(null,'Box Jump','Full body','Box','Jump','Plyometric','A jump onto a stable platform.','Use a suitable low height and prioritise a controlled landing.'),
(null,'Kettlebell Swing','Full body','Kettlebell','Hinge','Power','A ballistic hip-hinge exercise.','Learn the hinge pattern first and use a manageable load.'),
(null,'Incline Push-Up','Chest','Bodyweight','Horizontal push','Compound','A push-up using an elevated hand position.','Choose a stable support and maintain a steady trunk.'),
(null,'Assisted Pull-Up','Back','Machine','Vertical pull','Compound','A pull-up using a counterbalance machine or band.','Use assistance that allows controlled repetitions.'),
(null,'Dumbbell Step-Up','Legs','Dumbbell','Step','Compound','A single-leg step-up to a stable platform.','Use a secure platform and step with control.'),
(null,'Reverse Lunge','Legs','Bodyweight','Lunge','Compound','A reverse-step lunge variation.','Step back with balance and use a comfortable depth.')
on conflict do nothing;
