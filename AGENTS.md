# AI FSM Desktop - Agent Instructions

## 项目概述

Electron 桌面应用，用于可视化多智能体闭环编排。OpenCode 负责规划和验收，Claude Code 负责执行代码修改。

项目位置：仓库根目录

## 开发工作流

### 构建和发布

```bash
npm run make          # 完整构建：bump 版本 → 打包 → 安装到 Squirrel → 同步快捷方式
npm run lint          # TypeScript 类型检查（tsc --noEmit）
npm test              # 运行 vitest 测试
npm start             # 开发模式启动
```

### 版本更新日志

每次发布新版本时，**必须**写入更新日志。使用 `BUMP_MESSAGE` 环境变量：

```bash
BUMP_MESSAGE="功能描述\n另一个改动" npm run make
```

多条记录用 `\n` 分隔，会自动转换为 `- ` 列表项。

也可以单独写入 changelog（不构建）：

```bash
npm run changelog:add -- "改动描述\n另一个改动"
```

**不要**直接运行 `npm run make` 而不提供 `BUMP_MESSAGE`，否则版本号会递增但没有更新日志条目。

### 测试

```bash
npm test    # vitest run
```

测试文件位于 `src/shared/schema.test.ts`，覆盖：
- verificationResponseSchema 验证（score 1-10）
- workflowRuntimeConfigSchema 验证（passingScore）
- 分数阈值路由逻辑（score >= passingScore → approved）
- 快照字段回归

## 代码规范

- 不要添加未经确认的 npm 依赖
- 保持现有 UI 风格（Tailwind CSS + React Flow）
- 所有新增类型定义放在 `src/shared/schema.ts`
- IPC 接口定义在 `src/shared/ipc.ts`
- 不要修改 `--dangerously-skip-permissions` 相关代码

## 关键架构

- **状态机**：`src/backend/workflowStateMachine.ts` — 单个 workflow 的 phase engine
- **Manager**：`src/backend/workflowManager.ts` — queue、历史、恢复、session 编排
- **协作**：`src/backend/collaborationCoordinator.ts` — 多 agent 协调
- **配置**：`src/backend/configManager.ts` — Zod 验证、默认值、热更新
- **持久化**：`src/backend/workflowSessionStore.ts` — JSONL 存储、自动清理
- **IPC**：`src/shared/ipc.ts` — 共享类型和 API 接口
- **Schema**：`src/shared/schema.ts` — Zod schema 定义
