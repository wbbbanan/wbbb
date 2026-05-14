# Changelog

## v0.1.79 (2026-05-14)
- 设置页面重构为分类双栏布局
新增 10 个设置分类：通用、AI 模型、超时与性能、容错与重试、规划限制、运行时配置、Prompt 模板、数据管理、快捷键、健康检查
补全缺失配置字段：cleanupPeriodDays、maxRepairAttemptsPerStep、maxTotalRepairAttempts、maxPlanSteps
新增数据管理功能：清除所有历史、导出 ZIP、自动清理天数调节
新增重置默认二次确认弹窗
新增 UI 偏好 store：自动滚动开关（默认开启）、快捷键自定义预留结构
新增后端 IPC：clearAllSessions、exportAllSessionsZip
安装 adm-zip 依赖用于 ZIP 导出

## v0.1.78 (2026-05-14)
- 修复真实 ChatView 渲染路径中的 OpenCode / Claude 品牌图标
同步打包可见版本号，避免界面仍显示旧构建

## v0.1.77 (2026-05-14)
- OpenCode / Claude 品牌图标接入聊天与设置页
修复版本号 bump 同步 package-lock，避免打包版本倒退

## v0.1.76 (2026-05-14)
- 可调整大小的面板布局
新增 ResizablePanel 通用拖拽组件
AppShell 左侧导航栏支持拖拽调整宽度（180px–400px，默认 260px）
ChatView 左侧会话列表支持拖拽调整宽度（200px–400px，默认 280px）
ChatView 右侧上下文面板支持拖拽调整宽度（200px–400px，默认 280px）
面板宽度自动保存到 localStorage，重启后恢复
移动端保持原有固定宽度行为不变

## v0.1.72 (2026-05-13)
- Multi-turn conversation support
- Add continueAgentFlow API for continuing existing sessions
- Backend: WorkflowManager.continueSession() and WorkflowStateMachine.continueWorkflow()
- Frontend: auto-detect completed/failed/paused sessions and call continue instead of start
- Budget is preserved across turns (cumulative)
- Existing plan is kept and new steps are appended
- Extended JSON filtering: also hide verification results (status, score, summary, failed_reasons)

## v0.1.70 (2026-05-13)
- Filter internal coordinator instructions from UI
- Backend: skip JSON delegate messages in extractClaudeExecutionDetails
- Frontend: fallback filter in flattenActivityTrace for message items starting with JSON action
- AgentTurn: only last message expanded, earlier messages folded into process steps
- Diff syntax highlighting: green + lines, red - lines
- Full Chinese localization for all UI labels and placeholders

## v0.1.67 (2026-05-13)
- Grayscale redesign: Cursor-style muted interface
- Removed all neon colors (amber/green/red/yellow)
- Warm gray palette: #1e1e1e background, #252526 sidebar
- Flat message layout, no colored status indicators
- Grayscale buttons and badges
- Subtle borders (#333), barely visible
- Only blue for links, everything else grayscale

## v0.1.64 (2026-05-13)
- Frontend complete redesign: Claude-style clean UI
- Unified design system with solid backgrounds and warm amber accent
- Left sidebar navigation replacing top nav pills
- Clean conversation layout with flat message design
- Redesigned DAG nodes, session list, config forms
- Lucide icons replacing all inline SVGs
- Simplified typography removing uppercase tracking abuse
- Enhanced micro-interactions and animations

## v0.1.61 (2026-05-13)
- 重构ProcessRunner提取共享函数

## v0.1.60 (2026-05-13)
- 重构ProcessRunner提取共享函数

## v0.1.59 (2026-05-12)
- CI pipeline 集成（.github/workflows/ci.yml）、新增 WorkflowManager/workflowRecovery/logger 集成测试（76 tests）、ChatView 消息复制按钮和键盘快捷键（Esc 关闭面板、Ctrl+/ 聚焦搜索）

## v0.1.58 (2026-05-12)
- 打包与发布质量：新增 pre-pack-check.js 自检脚本（版本一致性、CHANGELOG 完整性、版本排序、lint、测试），新增 prepack:check npm script

## v0.1.57 (2026-05-12)
- WorkflowCanvas DAG 交互优化：选中节点时自动聚焦居中（fitView with maxZoom 1.2），使用 useReactFlow hook 实现

## v0.1.56 (2026-05-12)
- 结构化日志：新增 logger.ts 工具模块（时间戳+模块前缀+级别过滤），WorkflowManager/processRunner/WorkflowStateMachine 统一使用

## v0.1.55 (2026-05-12)
- ChatView 交互改进：智能滚动锚定（仅在底部时自动滚动）、新消息浮动按钮、事件过滤器状态计数徽章

## v0.1.54 (2026-05-12)
- 配置容错与回退：readConfigOverride 损坏文件安全回退到 null、mergeConfig 无效合并结果回退到 base、updateWorkflowConfig reload 异常保护

## v0.1.53 (2026-05-12)
- HealthCheck 覆盖扩展：新增 node-pty 运行时可用性检测、工作目录可写性探测，健康检查传递 workspaceDir 参数

## v0.1.52 (2026-05-12)
- WorkflowRecovery 错误分类增强：新增 OOM 模式（exit 137/heap 关键词）、段错误 exit 139、磁盘空间不足、文件权限问题分类，OOM 自动重试延迟加倍

## v0.1.51 (2026-05-12)
- Session 数据完整性校验：加载时验证 sessionId/snapshot 必须字段、损坏记录自动修复或跳过、生命周期和执行状态枚举校验

## v0.1.50 (2026-05-12)
- ProcessRunner 进程生命周期加固：活跃进程注册表、app 退出时自动清理子进程、三个 spawn 函数统一 track/untrack

## v0.1.49 (2026-05-12)
- WorkflowManager 防御性守卫：handleEnvelope 空值保护、pumpQueue 异常捕获、scheduled resume 定时器错误处理、recoverPersistedSessions 逐条容错、releaseActiveSession 清理定时器

## v0.1.47 (2026-05-10)
- 修复重启后对话历史丢失：useWorkflowEvents 加载最近 session 事件
- 添加中断恢复栏：暂停/熔断器/审核/失败状态可一键操作

## v0.1.45 (2026-05-10)
- 修复实时流式活动无法显示：flattenActivityTrace 同时检查 event.activityTrace 字段

## v0.1.44 (2026-05-10)
- 子代理执行过程实时流式推送到前端 UI
支持并发子代理派发 (Promise.all)
后验文件冲突检测机制
扩展 CoordinatorDelegateCommand 支持 tasks 数组

## v0.1.43 (2026-05-10)
- 实现子代理输出 LLM 语义摘要 (Summarizer)
引入跨步骤持久化记忆库 (Agent Memory Bank)
Coordinator complete 指令支持 saveMemories 字段
为并发子代理冲突检测预留 modifiedFiles 字段

## v0.1.42 (2026-05-10)
- 修复 OpenCode stdin 挂起问题 (spawn stdin:pipe + stdin.end)

## v0.1.41 (2026-05-10)
- 修复 Windows 上 OpenCode spawn 挂起问题 (shell: true)

## v0.1.40 (2026-05-10)
- 修复 OpenCode 规划超时问题

## v0.1.39 (2026-05-10)
- Coordinator Agent + Sub-Agent 分发架构
- FSM 循环: dispatch→working→review
- 物理隔离子代理进程
- 执行历史追踪

## v0.1.38 (2026-05-10)
- 使用 execFile 替代 spawn 解决 Windows 中文编码问题

## v0.1.37 (2026-05-10)
- 添加 opencode binary 路径调试日志

## v0.1.36 (2026-05-09)
- 使用 opencode.exe 原生 binary 绕过 .cmd shim 编码问题

## v0.1.35 (2026-05-09)
- 修复 Windows 编码问题：优先使用 .exe 原生 binary 而非 .cmd shim，彻底解决中文 prompt 乱码

## v0.1.34 (2026-05-09)
- 修复 Windows 编码问题：.cmd shim 不再解析为 node 脚本，改用 cmd /c 运行以保留 Unicode 编码

## v0.1.33 (2026-05-09)
- 添加 processRunner 调试日志：spawn 命令和失败时的 stdout/stderr

## v0.1.32 (2026-05-09)
- 改进 OpenCode 错误报告：stderr 信息现在会显示在事件消息中，方便诊断 exit code 1 问题

## v0.1.31 (2026-05-09)
- 彻底修复历史对话黑屏：消除无限 re-render 循环
- - workflowStore 改为缓存 displayedEvents/displayedGraph 稳定引用
- - refreshSessions 仅在数据变化时更新 inspectedSession
- - 组件直接读取缓存字段而非调用计算选择器

## v0.1.30 (2026-05-09)
- 修复历史对话黑屏：添加 ErrorBoundary + 防御性空值检查
- - workflowStore getDisplayed* 选择器增加 try-catch
- - graph.ts buildGraphFromEvents 跳过畸形事件
- - format.ts flattenActivityTrace 增加防御检查
- - AppShell 路由内容包裹 ErrorBoundary

## v0.1.29 (2026-05-09)
- 修复两个问题：1) 新消息覆盖旧对话历史 2) OpenCode 用 stdin 读不到 prompt，改回 positional arg
- Claude 保留 stdin 传 prompt

## v0.1.27 (2026-05-09)
- 修复窗口标题不显示版本号：清除 HTML title 标签覆盖

## v0.1.26 (2026-05-09)
- 修复 Windows 命令行编码问题：prompt 通过 stdin 传递而非命令行参数，解决中文乱码导致进程卡死

## v0.1.25 (2026-05-09)
- 修复 recoverPersistedSessions 中 budget 回填顺序，解决 listSessions 崩溃

## v0.1.24 (2026-05-09)
- 移除 Squirrel 安装机制，快捷方式指向 forge-out
- 清理 electron-squirrel-startup 依赖和相关脚本

## v0.1.21 (2026-05-09)
- UI 统一为 Gemini 风格：rounded-xl、深灰背景、蓝色按钮

## v0.1.20 (2026-05-08)
- UI 重新设计（Gemini）：圆角现代风格、蓝色按钮、单行样式类

## v0.1.19 (2026-05-08)
- AGENTS.md 开发规范文档
- CHANGELOG 打包修复

## v0.1.18 (2026-05-08)
- CHANGELOG.md 打包到应用 resources 目录，修复打包后无法读取的问题
- bump-version.js 支持 BUMP_MESSAGE 环境变量自动写入 changelog
- 添加 AGENTS.md 开发规范文档

## v0.1.15 (2026-05-08)
- CHANGELOG.md 初始历史补全
- preload.ts 加入 sync:playground 同步列表

## v0.1.14 (2026-05-08)
- Squirrel 安装自动更新机制（install-squirrel-update.js）
- 快捷方式指向 Squirrel 安装的 exe，不再指向 forge-out
- Shared contract 收敛：ipc.ts 和 schema.ts 在 Desktop/Playground 间完全同步
- 协作消息格式统一：source 改为对象格式，metadata 改为 details
- 添加 CHANGELOG.md 机制和 UI 更新日志查看器

## v0.1.13 (2026-05-08)
- 结构化 activity trace 解析（OpenCode JSON 流 + Claude stream-json）
- 聊天式时间线 UI（ActivityTraceCard 组件）
- Claude stream-json 执行路径（--output-format stream-json）
- 阶段活动流面板：选中节点可查看 thinking/tool_use/tool_result/message

## v0.1.12 (2026-05-08)
- 分数阈值路由：score >= passingScore 作为通过标准，不信任模型回传 status
- 评分标准 prompt：1-10 分制，9 分以上才通过
- 规划 prompt 强制原子步骤拆分

## v0.1.11 (2026-05-08)
- 用户介入 API：pause/resume/cancel/manualApprove/manualReject
- UI 操作按钮：运行中/暂停/needs_review 状态下显示不同按钮
- JSONL 持久化存储：按 session 拆分目录，session.json + events.jsonl
- 自动清理过期 session（cleanupPeriodDays 配置）

## v0.1.10 (2026-05-08)
- 有界 verification 退化：maxRepairAttemptsPerStep / maxTotalRepairAttempts
- needs_review 状态：达到修复上限时等待人工裁决
- 版本号显示在 UI 左上角

## v0.1.9 (2026-05-08)
- Session 持久化：workflow-sessions.json 持久化 workflow 状态和事件
- Crash recovery：启动时检测 interrupted session，标记为可恢复
- Queue 管理：排队、定时恢复、pump queue
- Session resume：hydrate() + resume() + getPersistedState()
- Manager 层持久化索引：workflow-manager-state.json

## v0.1.8 (2026-05-07)
- 构建产物版本同步修复
- npm run make 生成 0.1.8 安装包

## v0.1.7 (2026-05-07)
- UI 配置面板：运行设置编辑、prompt 模板编辑
- 健康检查面板：OpenCode/Claude 可用性检测

## v0.1.6 (2026-05-07)
- 历史 Session 面板：查看已完成/失败的 session
- Session 恢复：从历史 session 断点续跑

## v0.1.5 (2026-05-07)
- 协作协调器：CollaborationCoordinator + CollaborationLocalTransport
- 多 agent 会话管理：创建/暂停/恢复会话
- 消息追加和 agent 状态跟踪

## v0.1.4 (2026-05-07)
- 有界退化基础：Circuit Breaker 熔断机制
- 指数退避重试：processRetry / jsonRepairRetry / executionRetry
- 错误分类和恢复策略

## v0.1.3 (2026-05-07)
- OpenCode 流式输出解析：NDJSON 事件提取
- Verification 评分和决策路由
- 结构化 JSON 修复重试

## v0.1.2 (2026-05-07)
- Claude Code 执行集成：PTY 进程管理
- 执行摘要提取和验证
- 协作执行路径（coordinator 模式）

## v0.1.1 (2026-05-06)
- Planning 阶段：OpenCode 生成结构化计划
- 步骤扩写：生成详尽的 Claude 执行提示词
- React Flow DAG 可视化：状态机全景图

## v0.1.0 (2026-05-06)
- 初始版本：Electron + React + TypeScript + Tailwind CSS
- 多阶段状态机架构：planning → execution → verification → decision
- PTY 进程管理（node-pty）
- 共享类型定义：ipc.ts + schema.ts
- 预加载桥接：preload.ts IPC 通道
