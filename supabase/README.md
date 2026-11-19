# 白城麻将 · Supabase 接入说明

`web/apps/web/src/lib/auth.ts` 是前端统一账号层：**配置了 Supabase 就走云端，没配置就自动降级为本地 Demo**，两种模式接口完全一致，页面无需关心当前是哪种。

## 一、无后端本地 Demo（默认）

`VITE_SUPABASE_URL` 或 `VITE_SUPABASE_ANON_KEY` 留空即为 Demo 模式，账号和 session 存在浏览器 `localStorage`（前缀 `redbird:`），预置账号：

| 用户名 | 密码 | 说明 |
| --- | --- | --- |
| `demo` | `demo123` | 管理员，金币 8888、房卡 20 |
| `player1` | `123456` | 普通玩家 |
| `player2` | `123456` | 普通玩家 |

Demo 密码用 `btoa` 简单编码，**仅限本地演示，绝不可用于真实环境**。清掉浏览器站点数据即可重置。

## 二、接入真实 Supabase

1. 到 https://supabase.com 用 GitHub 账号登录，**New project** 新建一个项目（区域选离用户近的，数据库密码妥善保存）。
2. 左侧菜单 **SQL Editor → New query**，把 `supabase/migrations/001_init.sql` 全文粘贴进去点 **Run**，看到成功提示即可（可重复执行）。
3. 左侧 **Project Settings → API**，复制 **Project URL** 和 **anon public** key（**不要用 service_role key**，它会绕过 RLS）。
4. 在 `web/apps/web/` 下把 `.env.example` 复制为 `.env.local`，填入：

   ```env
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   VITE_GAME_SERVER_URL=wss://your-game-server.example.com
   VITE_ADMIN_EMAILS=admin@example.com
   ```

5. 本地测试建议到 **Authentication → Providers → Email** 关掉 **Confirm email**，否则注册后需先去邮箱验证才能登录。
6. 重启 `npm run dev`，账号层自动切换到云端。

## 三、设置第一个管理员

先正常注册一个账号（例如用户名 `admin`），再到 SQL Editor 执行：

```sql
update public.profiles set is_admin = true where username = 'admin';
-- 若用户名不记得，可按邮箱查：
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'admin@example.com');
```

刷新页面后该账号即拥有后台权限：可读取所有玩家资料、修改金币/房卡、封禁用户。普通用户即使手动改前端请求，也会被 `protect_sensitive_fields` 触发器拒绝。

## 四、用户名登录约定

Supabase 原生用邮箱登录。为兼容老游戏「用户名 + 密码」习惯：

- 若注册邮箱填 `用户名@redbird.local`，则可直接用 `signInWithUsername(用户名, 密码)` 登录；
- `signIn(email, password)` 在未包含 `@` 时会自动补 `@redbird.local`；
- 用真实邮箱（如 `xxx@gmail.com`）注册的账号，请用邮箱登录。

## 五、数据表与权限速查

- `profiles`：每个 `auth.users` 用户一行，含金币、房卡、胜场、战绩 JSONB、管理员/封禁标记；注册时由触发器自动建行。
- 普通用户：只能查/改**自己**的资料，且改不了金币、房卡、管理员、封禁字段。
- 管理员：可查/改**所有**资料。
- `leaderboard`：只读视图，按金币降序，供排行榜使用。
- 战绩写入建议由游戏服务端用 `service_role` key 更新 `record_data / games / wins`（前端 anon key 也可写 `record_data`，看部署需要）。
