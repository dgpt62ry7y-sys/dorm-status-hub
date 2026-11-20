# DormSync / 宿舍状态共享站

[![CI](https://github.com/dgpt62ry7y-sys/dorm-status-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/dgpt62ry7y-sys/dorm-status-hub/actions/workflows/ci.yml)

DormSync 是一个可自行部署的四人寝、六人寝状态共享 Web App。室友通过邀请码加入同一个空间，查看彼此的活动、专注、睡眠和外出状态，并通过可选 ntfy 频道接收状态提醒。

项目由个人维护，适合小规模宿舍自用和二次开发。不承诺 SLA，也不宣称已经具备大型生产系统所需的高可用、审计或运维能力。

## 功能

- 四人寝、六人寝创建与容量调整
- 邀请码或分享链接加入
- 睡觉中、正常活动、专注学习、外出四种状态
- 留言、预计结束时间、预计回寝时间和自动恢复
- 当前成员置顶、安静人数和预计安静结束时间
- 同一账号最多绑定 5 台设备
- 设备绑定码、账号恢复码和设备撤销
- 房主管理邀请码、成员和房型
- 每个宿舍独立的 ntfy 共享通知 Topic
- 全站版本公告和设置页功能更新日志
- 寝室创建密钥、存量寝室验证和定时清理
- PWA 离线应用外壳与前台自动同步

## 技术架构

```text
Vue 3 + TypeScript Web App
            |
            | HTTPS
            v
CloudBase HTTP Function
            |
            | member token
            v
CloudBase PostgreSQL
└── Document extension
```

- 前端：Vue 3、TypeScript、Vite、Vue Router
- 图标：Lucide
- 后端：腾讯云 CloudBase HTTP 云函数
- 数据：CloudBase PostgreSQL + Document 扩展
- 托管：CloudBase 静态网站托管
- 通知：可选 ntfy 服务
- 清理：CloudBase 定时云函数

详细模块、权限和数据边界见 [架构说明](docs/architecture.md)。

## 自行部署

需要准备：

- Node.js 20 或更高版本
- npm 10 或更高版本
- 腾讯云 CloudBase 环境
- CloudBase PostgreSQL 与 Document 扩展
- CloudBase 静态网站托管

基本流程：

```bash
npm ci
cp .env.example .env.local
npm run deploy:api
```

首次部署 API 后，把网关地址填入 `VITE_DORMSYNC_API_URL`，再执行：

```bash
npm run build
npm run deploy:web
```

完整步骤、CloudBase 资源准备和费用边界见 [自行部署指南](docs/self-hosting.md)。

## 环境变量

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `VITE_CLOUDBASE_ENV_ID` | 前端 CloudBase 环境 ID | 是 |
| `VITE_DORMSYNC_API_URL` | 前端访问的 HTTPS API 网关地址 | 是 |
| `DORMSYNC_CREATOR_KEY` | 创建宿舍时的授权密钥 | 是 |
| `DORMSYNC_ADMIN_KEY` | 本地只读管理站密钥 | 是 |
| `DORMSYNC_NTFY_SERVER` | 云函数使用的 ntfy 服务地址 | 否 |
| `DORMSYNC_NTFY_PUBLIC_URL` | 设置页展示和深链使用的公开 ntfy 地址 | 否 |

`.env.local` 已被 Git 忽略，不应提交。仓库中的 `.env.example` 只有占位值。

## 本地开发

```bash
npm ci
npm run dev
```

验证：

```bash
npm test
npm run check:release
npm run build
```

本地只读管理站：

```bash
npm run admin
```

独立六账号测试版：

```bash
npm run dev:test
```

测试环境使用内存数据库和本地通知收件箱，不连接正式 CloudBase。Windows 完成依赖安装和 `.env.local` 配置后，也可以双击 `启动本地工具.bat`。

## 安全与隐私

- 浏览器不直接访问数据库，只通过 HTTPS 调用云函数
- 数据库保存设备令牌、绑定码和恢复码的哈希，不保存明文
- 创建密钥和管理密钥只通过云函数环境变量注入
- 未登录接口带时间窗尝试限流
- 仓库不包含成员令牌、恢复码、真实邀请码或生产密钥
- 应用不采集定位、通讯录、麦克风或摄像头
- ntfy Topic 是共享秘密而不是强访问控制；知道 Topic 的人可以订阅、读取或伪造消息
- 启用通知后，昵称、状态、留言和预计时间会发送到部署者选择的 ntfy 服务

安全问题请按 [安全政策](SECURITY.md) 私密报告，不要发布到公开 Issue。

## 项目结构

```text
src/                  Vue 前端
admin/                本机只读管理站
cloudfunctions/api/   云函数与版本数据
docs/                 架构、部署、许可和设计文档
tests/                自动化测试与本地测试服务
public/               PWA、图标和字体
```

## 参与贡献

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全政策](SECURITY.md)
- [Issue 模板](.github/ISSUE_TEMPLATE)

提交前请运行 `npm test` 和 `npm run build`。

## 许可证与署名

本项目使用 [MIT License](LICENSE)，版权声明为 `Copyright (c) 2026 BAI`。

MIT 允许使用、复制、修改、合并、发布、分发、再许可和销售软件副本，也允许商业使用。分发软件或其重要部分时，必须保留原版权声明和 MIT 许可证文本。软件按“原样”提供，不附带明示或默示担保。

在 README、关于页面或文档中注明原项目来源是维护者鼓励的良好实践，但不是 MIT 之外的强制条件。MIT 不要求二次开发者公开修改后的源代码。

建议标注：

```text
本项目基于 DormSync 开发。
原项目：https://github.com/dgpt62ry7y-sys/dorm-status-hub
本项目经过独立修改，非 DormSync 官方发布版本。
```

MIT 授权代码，不自动授予 DormSync 名称、Logo 或官方身份。品牌边界、来源标注示例和第三方素材许可见 [许可证与署名说明](docs/ATTRIBUTION.md)。
