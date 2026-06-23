# Caddy Manager

一个基于 React + TypeScript 的 Caddy 反向代理配置管理面板，支持表单化路由编辑、版本历史和一键回滚。

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（同时启动前端 + 后端）
npm run dev

# 仅启动后端
npm run dev:server

# 仅启动前端
npm run dev:frontend
```

## 生产部署

```bash
# 构建前端
npm run build

# 启动生产服务（后端托管前端静态文件）
npm start
```

## 配置

所有运行参数在 `config.json` 中配置：

```json
{
  "server": {
    "port": 3456              // 后端服务端口
  },
  "caddy": {
    "caddyfilePath": "/path/to/Caddyfile",  // Caddy 配置文件路径
    "adminApi": "http://localhost:2019"       // Caddy Admin API 地址
  },
  "frontend": {
    "basePath": "/caddy",     // 前端 basePath（也是 API 路径前缀）
    "port": 5174              // 前端开发服务器端口
  },
  "history": {
    "maxSnapshots": 50        // 最大保留快照数
  }
}
```

## 通过 Caddy 代理访问

在你的 Caddyfile 中添加：

```
:80 {
    handle /caddy* {
        reverse_proxy localhost:3456
    }
}
```

然后 `caddy reload --config /path/to/Caddyfile`，即可通过 `http://localhost/caddy/` 访问管理面板。

## 功能

- **Routes** - 表单化管理路由规则（路径、目标、strip prefix、headers）
- **Raw** - 直接编辑 Caddyfile 原始内容
- **History** - 查看历史版本、预览、一键回滚

## 目录结构

```
caddy-manager/
├── config.json          # 运行配置
├── server/index.ts      # Express 后端
├── src/                 # React 前端
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── data/                # 运行时数据
│   ├── history.json     # 版本历史记录
│   └── snapshots/       # 配置快照文件
└── package.json
```
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
