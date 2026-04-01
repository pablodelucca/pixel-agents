# Pixel Agents Remote

> Fork 自 [pixel-agents](https://github.com/pablodelucca/pixel-agents)

[English](README.md) | 简体中文

将原 VS Code 扩展改造为独立 Web 应用，可在浏览器中远程监控所有 Claude Code 会话状态。

## 改动说明

原项目是一个 VS Code 扩展，只能在 VS Code 侧边栏中显示。本版本：

- 移除 VS Code 扩展依赖，改为独立 Web 应用
- 添加 WebSocket 服务器，实时监控 `~/.claude/projects/` 下的 JSONL 文件
- 支持多房间管理，不同项目独立布局
- 支持远程部署，可通过域名访问

## 快速开始

```bash
# 安装依赖
cd remote-server && npm install
cd ../webview-ui && npm install

# 启动
npm run dev
```

访问 http://localhost:5174

Windows 用户可直接双击 `start-remote.bat` 启动。

## 部署

### Docker

```bash
docker-compose up -d --build
```

### Nginx + Node.js

```bash
# 1. 启动服务器
cd remote-server && PORT=3000 npx tsx server.ts

# 2. 构建前端
cd webview-ui && npm run build

# 3. Nginx 托管 dist/webview/ 并反向代理 /ws 到 3000 端口
```

参考 `nginx.conf.example`。

WebSocket 地址自动检测：
- localhost → `ws://localhost:3000`
- 服务器 → `wss://当前域名/ws`

## 项目结构

```
remote-server/          WebSocket 服务器，监控 JSONL 文件
webview-ui/             前端界面
shared/                 共享资源（精灵图、家具目录等）
Dockerfile
docker-compose.yml
nginx.conf.example
```

## 使用说明

- **绿色圆点**: Agent 正在执行工具
- **灰色圆点**: Agent 空闲
- **黄色圆点**: 等待用户确认

点击右上角 Connected 可管理房间，每个项目可创建独立房间。

## License

MIT