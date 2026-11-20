# 自行部署宿舍状态共享站

本文面向第一次接触 CloudBase 的使用者。目标是让你把项目部署到自己的腾讯云账号，得到一个由你控制的宿舍状态网站。

## 先分清两种使用方式

### 在线体验

当前 README 不承诺固定的公共演示地址。如果维护者以后提供在线地址，网页、云函数和数据库会运行在维护者的 CloudBase 环境里，维护者承担资源费用，并可能调整使用限制或停止演示服务。

### 自行部署

自行部署会复制一套代码到你自己的账号：

- 你会得到自己的网页、自己的云函数和自己的数据库。
- 你的数据与维护者演示环境相互独立。
- 云资源费用由你的腾讯云账号承担。
- 一个部署可以服务一个或多个宿舍，不需要每位室友分别部署。
- 一个宿舍通常只需要一个人部署，其他室友打开分享链接即可加入。
- 当前每个宿舍最多支持 4 人或 6 人，由创建者在创建时选择。
- 腾讯云的实际套餐、额度和价格以你自己的 CloudBase 控制台为准。

项目代码本身不会替你创建腾讯云账号、CloudBase 环境、PostgreSQL 资源，也不会替你的云资源付费。

## 部署后会得到什么

部署完成后，你可以：

- 创建四人寝或六人寝。
- 通过邀请码或链接邀请室友。
- 共享睡觉、正常活动、专注学习和外出状态。
- 设置状态留言、预计结束时间或回寝时间。
- 为宿舍设置共享 ntfy 通知频道，在室友改状态时接收手机提醒。
- 为 iPhone/iPad 登记 Bark Device Key，接收同一份宿舍通知。
- 将同一个成员账号绑定到手机和电脑。
- 使用账号恢复码、设备管理、容量调整和版本更新公告。

## 架构说明

自行部署涉及三部分：

1. `Vue 3` 前端，构建后部署到 CloudBase 静态网站托管。
2. `dormsyncHttp` 云函数，处理成员、状态、邀请和设备身份。
3. CloudBase PostgreSQL 的 Document 扩展，用于保存宿舍业务数据。
4. 可选的 ntfy 服务，支持 Android、iPhone、iPad 和桌面设备。
5. Bark 官方服务，作为 iPhone/iPad 的可选第二条通道。

浏览器不会直接连接数据库。前端只通过 HTTPS 调用你自己的 `dormsyncHttp` HTTP API。

更完整的内部结构见 [架构说明](architecture.md)。

## 部署前准备

你需要准备：

- 一个 GitHub 账号，用于 Fork 或下载仓库。
- 一个腾讯云账号。
- 一个 CloudBase 环境，并记录该环境的环境 ID。
- CloudBase PostgreSQL 资源。
- PostgreSQL 中的 Document 扩展。
- CloudBase 静态网站托管。
- Node.js 20 或更高版本。
- npm 10 或更高版本。

如果你还没有 PostgreSQL 或静态网站托管，请先在 CloudBase 控制台确认开通方式、套餐和费用。

## 第一步：获取代码

可以 Fork 仓库后在本地克隆，也可以下载源码压缩包。

```bash
git clone <你的仓库地址>
cd dorm-status-hub
```

安装项目依赖：

```bash
npm install
```

## 第二步：准备 CloudBase 资源

在你的腾讯云 CloudBase 控制台完成以下事项：

1. 创建或选择一个 CloudBase 环境。
2. 记录环境 ID。
3. 创建 PostgreSQL 共享实例或符合当前控制台要求的 PostgreSQL 资源。
4. 开启 Document 扩展。
5. 开通静态网站托管。

项目不会自动创建 CloudBase 环境或 PostgreSQL 实例，也不会替你选择套餐。

## 第三步：登录 CloudBase CLI

项目已将 `@cloudbase/cli` 安装为开发依赖。

```bash
npx tcb login
```

请确认登录的是拥有目标 CloudBase 环境的腾讯云账号。

## 第四步：创建自己的本地环境配置

不要直接使用仓库中的 `.env.example` 线上值。它只有占位符，必须替换成你的环境信息。

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS / Linux：

```bash
cp .env.example .env.local
```

第一次部署 API 时，`.env.local` 可以先填写环境 ID，API 地址暂时保留占位符：

```env
VITE_CLOUDBASE_ENV_ID=你的CloudBase环境ID
VITE_DORMSYNC_API_URL=https://your-api-domain/dormsyncApi
DORMSYNC_CREATOR_KEY=你的寝室创建密钥
DORMSYNC_ADMIN_KEY=你的本地管理密钥
DORMSYNC_BARK_ENCRYPTION_KEY=你的64位十六进制Bark加密密钥
DORMSYNC_NTFY_SERVER=https://ntfy.sh
DORMSYNC_NTFY_PUBLIC_URL=https://ntfy.sh
```

不要提交 `.env.local`。项目的 `.gitignore` 已将它排除。

## 第五步：先部署 HTTP 云函数

```bash
npm run deploy:api
```

该命令会：

- 校验当前版本的更新摘要。
- 从 `.env.local` 读取你的环境 ID。
- 显式把 `--env-id 你的环境ID` 传给 CloudBase CLI。
- 部署 HTTP 云函数 `dormsyncHttp`。
- 部署定时清理云函数 `dormsyncCleanup`。
- 配置网关路径 `/dormsyncApi`。
- 检测云函数依赖；首次部署缺少 `node_modules` 时交给 CloudBase CLI 安装依赖。
- 生成仅用于本次部署的临时配置，把两个密钥写入云函数环境变量，部署完成后删除临时配置。

仓库中的 `cloudbaserc.json` 是通用模板，不包含维护者环境 ID。npm 部署脚本会从 `.env.local` 读取你的环境 ID 并显式传入 `--env-id`。你自己手工执行 CLI 命令时也要确认使用了 `--env-id`。

## 第六步：获取自己的 HTTP API 地址

部署完成后，在 CloudBase 控制台进入 `dormsyncHttp` 的 HTTP 访问服务或网关详情，复制你的 HTTP API 地址。

地址应以 `/dormsyncApi` 结尾，例如：

```text
https://你的网关地址/dormsyncApi
```

不要复制安装者演示地址，也不要把维护者的 API 地址写进自己的配置。

回到 `.env.local`，替换成你的真实地址：

```env
VITE_CLOUDBASE_ENV_ID=你的CloudBase环境ID
VITE_DORMSYNC_API_URL=https://你的网关地址/dormsyncApi
DORMSYNC_CREATOR_KEY=你的寝室创建密钥
DORMSYNC_ADMIN_KEY=你的本地管理密钥
DORMSYNC_BARK_ENCRYPTION_KEY=你的64位十六进制Bark加密密钥
DORMSYNC_NTFY_SERVER=https://ntfy.sh
DORMSYNC_NTFY_PUBLIC_URL=https://ntfy.sh
```

## 第七步：构建前端

```bash
npm run build
```

构建前会检查：

- `VITE_CLOUDBASE_ENV_ID` 是否存在且不是占位符。
- `VITE_DORMSYNC_API_URL` 是否是有效的 HTTPS 地址。

检查失败时会直接停止，不会构建出一个默认连接维护者环境的网页。

## 第八步：部署静态网站

```bash
npm run deploy:web
```

该命令会：

- 再次读取你的环境 ID。
- 确认 API 地址已填写。
- 确认 `dist/index.html` 存在。
- 显式把 `--env-id 你的环境ID` 传给 CloudBase CLI。
- 上传 `dist/` 到你的静态网站托管。

CloudBase CLI 会在输出中给出静态网站地址。

## 首次调用和数据库集合初始化

云函数第一次被调用时，会尝试创建项目使用的文档集合：

- `rooms`
- `members`
- `statuses`
- `deviceSessions`
- `deviceLinks`
- `releaseClaims`
- `securityAttempts`
- `systemSettings`
- `pushSubscriptions`

这只会初始化项目内的集合，不会替你创建 CloudBase 环境、PostgreSQL 实例或 Document 扩展。

## 部署成功后检查

请逐项确认：

- [ ] 静态网站可以打开。
- [ ] 可以创建四人寝或六人寝。
- [ ] 创建寝室时会校验授权创建密钥。
- [ ] 可以用邀请码加入宿舍。
- [ ] 第二个浏览器或手机可以加入并同步状态。
- [ ] 同一成员账号可以绑定第二台设备。
- [ ] 状态修改会在 5 秒内同步。
- [ ] 睡觉和外出必须设置时间。
- [ ] 专注学习和外出可以填写留言。
- [ ] 到期状态会恢复正常并清空旧留言。
- [ ] 设置页可以读取宿舍 ntfy Topic，房主可以发送测试通知。
- [ ] 修改状态后，订阅同一 Topic 的设备能收到 Priority 4 通知。
- [ ] iPhone/iPad 可以登记 Bark Device Key，并先收到测试通知。
- [ ] 修改状态后，宿舍内有效 Bark 设备能收到相同通知。
- [ ] 同一位 iPhone 用户可以只使用 ntfy、只使用 Bark，或同时使用两种通道。
- [ ] 首次调用 API 后数据库集合已创建。
- [ ] 定时清理云函数 `dormsyncCleanup` 已创建。
- [ ] CloudBase 账单归属于你自己的账号和环境。

## 本地管理站

项目包含一个只在本机运行的管理站：

```bash
npm run admin
```

打开终端输出的 localhost 地址，输入 `.env.local` 中配置的 `DORMSYNC_ADMIN_KEY`。管理站只读取寝室名称、房主、人数、容量、活动时间和验证状态，不显示成员留言或任何密钥。

Windows 用户完成依赖安装和 `.env.local` 配置后，可以直接双击项目根目录的 `启动本地工具.bat`，从菜单选择管理站或六账号测试版。

## 本地六账号测试环境

运行：

```bash
npm run dev:test
```

本地测试环境使用独立内存数据库，不连接正式 CloudBase：

- 首次打开为空环境。
- 测试面板可以初始化一个六人寝和六个账号。
- 点击账号可以在同一浏览器切换身份。
- 可以重置全部虚拟数据。
- 测试面板中的通知收件箱会显示标题、Priority、正文和时间。
- 收件箱请求只发送到本机测试服务，不会访问真实 `ntfy.sh`。
- 本地测试服务也会拦截 Bark 批量请求，不调用真实 `api.day.app`。
- 终端会输出 `Phone test app` 局域网地址；手机与电脑在同一 Wi-Fi 时可以直接打开。
- 手机通过 Vite 同源代理访问本地测试 API，不需要把 API 端口暴露到局域网。

也可以在 Windows 双击 `启动本地工具.bat`，选择“启动六账号测试版”。启动器会检查 Node.js、项目依赖和 `.env.local`，但不会自动重复安装依赖。

## 后续更新

取得过 API 地址并完成第一次配置后，环境 ID 和 API 地址通常不需要再次修改。

更新代码并安装新依赖后，可以执行：

```bash
npm install
npm run deploy
```

`npm run deploy` 会依次：

1. 校验版本更新摘要。
2. 检查本地环境变量。
3. 构建前端。
4. 使用 `.env.local` 中的环境 ID 部署云函数。
5. 使用同一个环境 ID 部署静态网站。

`dormsyncHttp` 与 `dormsyncCleanup` 会同时部署。创建密钥和管理密钥只通过部署时生成的临时配置写入 `dormsyncHttp` 环境变量，不会写入 `cloudbaserc.json`。

部署脚本会校验 `DORMSYNC_BARK_ENCRYPTION_KEY` 是否为 64 位十六进制，并把它写入 `dormsyncHttp` 环境变量。该密钥必须长期保留；更换后，已有 Bark 设备需要重新登记。

如果配置了 `DORMSYNC_NTFY_SERVER` 和 `DORMSYNC_NTFY_PUBLIC_URL`，部署脚本也会把这两个值写入 `dormsyncHttp` 环境变量。生产环境应使用云函数可以访问、手机也能访问的 HTTP 或 HTTPS 地址。

如果 API 网关地址发生变化，必须先更新 `.env.local` 的 `VITE_DORMSYNC_API_URL`，再重新构建。

## 常见问题

### `envId` 仍然指向维护者环境

不要只运行裸 `tcb` 命令。使用本项目的 `npm run deploy:api` 和 `npm run deploy:web`，它们会从 `.env.local` 读取环境 ID 并显式传入 `--env-id`。

如果手工执行 CLI，请自行加上：

```bash
--env-id 你的环境ID
```

### 前端 API 地址还是维护者的

检查 `.env.local` 的 `VITE_DORMSYNC_API_URL`，然后重新执行：

```bash
npm run build
npm run deploy:web
```

只修改 `.env.local` 而不重新构建，已经生成的 `dist/` 不会自动更新。

### 构建提示环境变量缺失或仍是占位值

确认 `.env.local` 中填写的是你自己的环境 ID 和 API 地址，而不是 `your-env-id` 或 `your-api-domain`。

### 静态网站打不开

检查 CloudBase 静态网站托管是否已开通，以及 `npm run deploy:web` 是否上传成功。

### API 请求失败

依次检查：

- `dormsyncHttp` 云函数是否部署成功。
- HTTP 网关路径是否为 `/dormsyncApi`。
- `.env.local` 中的 API 地址是否与当前环境一致。
- PostgreSQL 是否运行。
- Document 扩展是否已启用。
- 查看 CloudBase 云函数日志中的具体错误。

### CLI 未登录或登录错账号

重新执行：

```bash
npx tcb login
```

确认登录的腾讯云账号拥有目标环境。

### 首次访问出现平台安全提示

CloudBase 默认测试域名首次访问时可能出现一次安全确认。具体提示以 CloudBase 当前控制台为准。

### 页面能打开但无法创建或加入宿舍

通常是前端 API 地址、云函数网关或数据库资源不一致。先检查浏览器网络请求，再查看云函数日志和 CloudBase 控制台。

### 创建寝室时一直提示密钥错误

检查 `.env.local` 中是否设置了 `DORMSYNC_CREATOR_KEY`，然后重新执行 `npm run deploy:api`。只修改本地变量但没有重新部署云函数时，线上仍使用旧密钥。

### 存量寝室被锁定

这是寝室授权迁移的保护状态。当前房主首次进入后需要在 12 小时内输入创建密钥；功能上线 3 天后仍未触发的存量寝室会被定时任务清理。

## 不要放进前端配置的内容

以下内容不应写入 `.env.local` 或提交到 Git：

- 数据库密码
- 服务端密钥
- 用户成员令牌
- 账号恢复码
- 设备绑定码
- 用户宿舍的 ntfy Topic
- Bark Device Key 或 Bark 加密密钥

前端只需要环境 ID 和公开 HTTP API 地址。

## 宿舍通知的第三方边界

- 默认通知服务是公共 `https://ntfy.sh`，不是本项目自建或托管的服务。
- iPhone/iPad 可以选择 ntfy，也可以额外使用 Bark 官方服务 `https://api.day.app`。
- 每个宿舍的 Topic 由服务端随机生成，但 Topic 本身相当于共享秘密。
- 知道 Topic 的人可以订阅、读取或伪造消息，不能把它当成强访问控制。
- 昵称、留言、预计时间和安静人数会发送到部署者选择的 ntfy 服务。
- Bark Device Key 使用 AES-256-GCM 加密保存，发送时仅在内存中短暂解密。
- 通知可能因手机后台限制、省电模式、网络或 ntfy 服务状态而延迟或失败。
- 通知失败不会撤销已经保存的宿舍状态。
- 如需更严格的数据边界，应自行部署并保护 ntfy 服务。

## 费用和数据边界

- 维护者演示站点使用维护者的云资源。
- 自行部署使用部署者自己的 CloudBase 环境和云资源。
- 两边的数据默认不会互通。
- 腾讯云套餐、额度、续费和价格以部署者自己的控制台为准。
