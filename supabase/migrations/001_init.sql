-- ============================================================
-- 白城麻将 · Supabase 数据库初始化
-- 使用方式：Supabase 控制台 → SQL Editor → New query，整体粘贴执行。
-- 本文件可重复执行（create table if not exists / create or replace）。
-- 建议在全新项目上一次性执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 玩家资料表
--    一行对应一个 auth.users 用户，id 与 auth.users.id 一致。
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  username    text        unique not null,              -- 用户名（登录展示名）
  avatar      text        not null default '0',         -- 头像（编号或 emoji）
  currency    bigint      not null default 1000,        -- 金币
  roomcard    integer     not null default 5,           -- 房卡
  games       integer     not null default 0,           -- 总场次
  wins        integer     not null default 0,           -- 胜场
  record_data jsonb       not null default '[]'::jsonb, -- 战绩数组（原 userData.recordData）
  is_admin    boolean     not null default false,       -- 是否管理员
  banned      boolean     not null default false,       -- 是否封禁
  created_at  timestamptz not null default now(),
  last_login  timestamptz,                              -- 最近登录时间
  updated_at  timestamptz not null default now()
);

comment on table  public.profiles                is '玩家资料：金币/房卡/战绩及管理员、封禁状态';
comment on column public.profiles.currency       is '金币余额，仅管理员或服务端可修改';
comment on column public.profiles.roomcard       is '房卡数量，仅管理员或服务端可修改';
comment on column public.profiles.record_data    is '战绩 JSON 数组，兼容旧版 userData.recordData';
comment on column public.profiles.is_admin       is '管理员标记，仅管理员或服务端可修改';
comment on column public.profiles.banned         is '封禁标记，仅管理员或服务端可修改';

-- ------------------------------------------------------------
-- 2. 判断当前请求用户是否管理员
--    security definer：以表 owner 身份读取，绕过 RLS，
--    避免在 profiles 的 RLS 策略里自引用造成无限递归。
-- ------------------------------------------------------------
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ------------------------------------------------------------
-- 3. 新用户注册后自动创建 profile
--    username 取注册时传入的 raw_user_meta_data->>'username'，
--    没传则用「玩家 + 随机后缀」，并保证唯一。
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_suffix   integer := 0;
begin
  -- 幂等：若 profile 已存在则直接跳过（避免重复注册事件报错）
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    '玩家' || substr(replace(new.id::text, '-', ''), 1, 8)
  );

  loop
    begin
      insert into public.profiles (id, username) values (new.id, v_username);
      exit;
    exception when unique_violation then
      -- 用户名撞车时追加数字后缀重试
      v_suffix := v_suffix + 1;
      v_username := v_username || v_suffix::text;
    end;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4. updated_at 自动维护
-- ------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ------------------------------------------------------------
-- 5. 敏感字段保护
--    普通用户不能自己改金币、房卡、管理员标记、封禁状态；
--    管理员可以改（后台管理用）；service_role（无 JWT）不受限制。
-- ------------------------------------------------------------
create or replace function public.protect_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 服务端 service_role 调用时 auth.uid() 为空，放行
  if auth.uid() is null then
    return new;
  end if;

  if not public.current_user_is_admin() then
    if     new.currency is distinct from old.currency
        or new.roomcard is distinct from old.roomcard
        or new.is_admin is distinct from old.is_admin
        or new.banned   is distinct from old.banned then
      raise exception '无权限修改金币/房卡/管理员/封禁等敏感字段';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_sensitive on public.profiles;
create trigger profiles_protect_sensitive
  before update on public.profiles
  for each row execute function public.protect_sensitive_fields();

-- ------------------------------------------------------------
-- 6. 行级安全（RLS）
--    普通用户：只能读/改自己那一行；
--    管理员：可读所有行、可改所有行（用于后台改金币房卡/封禁）。
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.current_user_is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
  for delete to authenticated
  using (public.current_user_is_admin());

-- 基础授权（Supabase 默认已授予，这里显式写出便于自建 Postgres 迁移）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 7. 排行榜视图
--    视图属主为 postgres（默认 bypassrls），因此对所有登录用户可见；
--    只暴露用户名/胜场/场次/金币，不含邮箱等隐私字段。
-- ------------------------------------------------------------
create or replace view public.leaderboard as
select
  username,
  wins,
  games,
  currency
from public.profiles
order by currency desc, wins desc;

comment on view public.leaderboard is '金币排行榜（昵称/胜场/场次/金币）';
grant select on public.leaderboard to anon, authenticated;

-- ============================================================
-- 完成。下一步：
--   1) 在 Authentication → Providers 中按需关闭 Email confirmation（方便本地测试）
--   2) 前端 .env 填入 Project URL 与 anon key；留空则自动进入本地 Demo 模式
--   3) 设置第一个管理员：注册账号后执行
--      update public.profiles set is_admin = true where username = '你的用户名';
-- ============================================================
