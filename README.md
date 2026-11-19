# ============================================================
# 白城麻将 · 老友  —  部署总览
# ============================================================
#
# 架构（Vercel + Cloudflare 双平台）：
#   ┌─────────────────────────────────────────────┐
#   │  前端 SPA (React/Vite)  →  静态托管          │
#   │  可同时部署到 Vercel 和 Cloudflare Pages     │
#   └──────────────────┬──────────────────────────┘
#                      │ ① 账号/数据 (HTTPS REST)
#                      ▼
#   ┌─────────────────────────────────────────────┐
#   │  Supabase  (Auth + Postgres + RLS)          │
#   └─────────────────────────────────────────────┘
#                      │ ② 实时对战 (WebSocket)
#                      ▼
#   ┌─────────────────────────────────────────────┐
#   │  Cloudflare Workers + Durable Objects       │
#   │  (游戏房间服务，仅 CF 支持长连接)            │
#   └─────────────────────────────────────────────┘
#
# 说明：Vercel 的函数不支持长连接 WebSocket，因此“真实多人实时对战”
# 只能跑在 Cloudflare。前端本身是纯静态的，两边都可部署。
# ============================================================

## 一、本地开发（零后端，开箱即用）

```bash
cd web/apps/web
npm install
npm run dev
# 打开 http://localhost:5173
```

不配置任何环境变量时，自动进入 **本地 Demo 模式**：
- 账号、金币、房卡、战绩存浏览器 localStorage
- 游戏用本地引擎，AI 自动陪玩，可完整体验出牌/碰杠胡/结算

演示账号：
- `demo / demo123`（管理员，可进后台）
- `player1 / 123456`、`player2 / 123456`

## 二、接入 Supabase（账号 + 数据 + 后台）

1. 打开 https://supabase.com 新建项目（免费档即可）。
2. 左侧 **SQL Editor → New query**，粘贴执行 `web/supabase/migrations/001_init.sql`。
3. **Authentication → Providers → Email**，关闭 "Confirm email"（方便测试，生产建议开启）。
4. **Project Settings → API** 复制 Project URL 和 anon public key。
5. 配置前端环境变量：

```bash
cd web/apps/web
cp .env.example .env.local
# 编辑 .env.local，填入：
#   VITE_SUPABASE_URL=https://xxxx.supabase.co
#   VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

6. 设置第一个管理员：注册账号后，在 SQL Editor 执行：
```sql
update public.profiles set is_admin = true where username = '你的用户名';
```

此时登录走真实 Supabase Auth，后台管理数据存 Postgres。详见 `web/supabase/README.md`。

## 三、部署游戏服务器到 Cloudflare Workers（真实多人对战）

```bash
cd web/apps/game-server
npm install
npx wrangler login              # 首次登录 Cloudflare 账号
npm run dev                     # 本地 ws://localhost:8787
npx wrangler deploy             # 部署，输出形如 https://redbird-game-server.<account>.workers.dev
```

部署后在前端 `.env.local`（以及托管平台的构建环境变量）里填：
```
VITE_GAME_SERVER_URL=wss://redbird-game-server.<account>.workers.dev
```
前端会自动连接 `wss://.../ws?roomId=xxx`，多人进入同一房间即可实时对战。

> Durable Objects 需要 Cloudflare 账户启用（免费档有额度）。`wrangler.toml`
> 里已声明 `ROOM` 绑定与 `v1` 迁移，首次部署自动创建。

## 四、部署前端

### 方案 A：Vercel
- 导入仓库，Framework 选 Vite
- **Root Directory** 设为 `web/apps/web`
- Build Command `npm run build`，Output `dist`（仓库内 `vercel.json` 已配置）
- 在 Project Settings → Environment Variables 填入第三节的 `VITE_*` 变量

### 方案 B：Cloudflare Pages
- Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
- Root Directory 设为 `web/apps/web`
- Build command `npm run build`，Build output `dist`
- Settings → Environment Variables 填入同样的 `VITE_*` 变量

两种方式产出的都是同一份纯静态 `dist`，可任选其一或两边都部署。

## 五、环境变量速查

| 变量 | 用途 | 留空行为 |
|------|------|----------|
| `VITE_SUPABASE_URL` | Supabase 项目地址 | 账号走本地 Demo |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名公钥 | 同上 |
| `VITE_GAME_SERVER_URL` | WebSocket 游戏服务 | 用本地引擎 + AI 陪玩 |
| `VITE_ADMIN_EMAILS` | 后台界面展示用 | 权限仍以数据库为准 |

## 六、目录结构

```
web/
├── apps/
│   ├── web/              前端 SPA（Vercel / CF Pages 部署）
│   │   ├── public/assets ★ 从旧版 H5 迁移的全部美术素材（约 5.7MB）
│   │   └── src/
│   │       ├── pages/    登录/大厅/房间/个人中心/后台
│   │       ├── components/
│   │       ├── lib/      auth/supabase/游戏客户端/麻将算法/协议
│   │       └── store/    zustand 状态
│   └── game-server/      CF Workers + Durable Objects 实时房间服务
│       └── src/          index / room / mahjong / types
└── supabase/
    └── migrations/001_init.sql   数据库表 + RLS + 触发器
```

## 七、已知取舍

- 旧版 `main.min.js` 是压缩混淆的白鹭(Egret)代码，无法复用；玩法逻辑按原
  服务端规则用现代 TS 重写（麻将核心在 `mahjong.ts` / `tiles.ts`）。
- 当前实现的是大众麻将（120 张牌）单机+联机框架；斗地主/牛牛可作为后续玩法
  模块按同一协议扩展。
- 敏感字段（金币/房卡/管理员/封禁）由数据库触发器和 RLS 保护，前端无法越权修改。
