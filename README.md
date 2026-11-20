# DormSync / 宿舍状态共享

DormSync 是一个面向四人寝和六人寝的轻量状态共享 Web App。室友通过邀请码加入同一个空间，共享休息、学习、活动和外出状态，减少因信息不同步造成的打扰。

项目目前由个人维护并持续迭代，适合小规模宿舍自用和二次开发，不承诺 SLA，也不宣称已经具备大型生产系统所需的高可用、审计或运维能力。

## 功能概览

- 创建四人寝或六人寝，通过邀请码或链接加入
- 共享睡觉、正常活动、专注学习和外出状态
- 状态留言、预计结束时间、外出回寝时间和自动恢复
- 当前成员自动置顶，展示安静人数和预计安静结束时间
- 5 秒自动同步，网络中断时保留最近数据
- 同一成员账号绑定最多 5 台设备
- 8 位短时设备绑定码和 20 位账号恢复码
- 查看、撤销设备，单独退出当前设备
- 房主管理邀请码、成员和四人寝/六人寝切换
- 全站版本更新公告和设置页新版本提示
- 寝室创建密钥、存量寝室授权验证和定时清理

## 使用方式

### 自行部署

项目不把任何维护者的 CloudBase 环境作为默认目标。自行部署需要准备你自己的腾讯云 CloudBase 环境、PostgreSQL、Document 扩展和静态网站托管。

完整步骤见 [自行部署指南](docs/self-hosting.md)。

自行部署后的网页、云函数和数据库使用部署者自己的云资源，资源费用由部署者承担。腾讯云的实际价格、额度和续费规则以部署者自己的控制台为准。

### 在线演示

当前 README 不提供固定的公共演示地址，也不保证存在长期在线体验服务。请使用自己的 CloudBase 环境进行部署和测试。

## 技术架构

```text
Vue 3 Web App
      |
      | HTTPS
      v
CloudBase HTTP 云函数
      |
      | 成员令牌校验
      v
CloudBase PostgreSQL
└── Document 扩展
```

- 前端：Vue 3、TypeScript、Vite、Vue Router
- UI 图标：Lucide
- 后端：CloudBase HTTP 云函数
- 数据：CloudBase PostgreSQL + Document 扩展
- 托管：CloudBase 静态网站托管
- 清理任务：CloudBase 定时云函数

更完整的模块和权限说明见 [架构文档](docs/architecture.md)。

## 本地运行

环境要求：

- Node.js 20 或更高版本
- npm 10 或更高版本

安装依赖：

```bash
npm install
```

从示例创建自己的环境配置：

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS / Linux：

```bash
cp .env.example .env.local
```

填写自己的 CloudBase 环境 ID、HTTP API 地址和服务端密钥后运行：

```bash
npm run dev
```

构建和测试：

```bash
npm test
npm run build
```

本地只读管理站：

```bash
npm run admin
```

使用独立虚拟数据库的六账号测试环境：

```bash
npm run dev:test
```

Windows 完成首次依赖安装和 `.env.local` 配置后，也可以直接双击：

```text
启动本地工具.bat
```

然后从菜单选择只读管理站或六账号测试版。菜单不会重复安装依赖，服务停止后可以返回菜单选择另一个工具。

## 隐私与安全

- 业务数据保存在部署者自己的 CloudBase 数据库。
- 浏览器不会直接访问数据库。
- 设备令牌保存在浏览器 `localStorage`，数据库只保存令牌哈希。
- 设备绑定码和账号恢复码只保存哈希。
- 创建密钥和管理密钥只保存在 CloudBase 云函数环境变量。
- 仓库不包含 `.env.local`、数据库密码、成员令牌、恢复码或真实邀请码。
- 应用不采集定位、通讯录、麦克风或摄像头。

详细说明见 [安全政策](SECURITY.md)。

## 参与贡献

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全政策](SECURITY.md)

提交代码前请运行：

```bash
npm test
npm run build
```

## 许可证

本项目使用 [MIT License](LICENSE)。

## 致谢

- [Vue](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [CloudBase](https://cloudbase.net/)
- [Lucide](https://lucide.dev/)
