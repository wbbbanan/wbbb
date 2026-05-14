import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings,
  Brain,
  Clock,
  Shield,
  GitBranch,
  Terminal,
  FileText,
  Database,
  Keyboard,
  HeartPulse,
  Monitor,
  Save,
  RotateCcw,
  RotateCcw as ResetIcon,
  AlertTriangle,
  X,
  Loader2,
  Download,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { useConfigStore } from '../../store/configStore';
import { useUIStore, type ThemeMode } from '../../store/uiStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { useConfig } from '../../hooks/useConfig';
import { useHealth } from '../../hooks/useHealth';
import { useAgentFlow } from '../../hooks/useAgentFlow';
import { useSessions } from '../../hooks/useSessions';
import { SettingsField, SettingsTextArea } from '../../components/SettingsField';
import { HealthCheckCard } from '../../components/HealthCheckCard';
import { secondaryButtonClass, healthStatusStyles, healthStatusLabels } from '../../lib/constants';
import toast from 'react-hot-toast';
import { toErrorMessage } from '../../lib/format';

const selectClass =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/20';

const CATEGORIES: { id: string; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: '通用', icon: Settings },
  { id: 'ai-model', label: 'AI 模型', icon: Brain },
  { id: 'timeout', label: '超时与性能', icon: Clock },
  { id: 'resilience', label: '容错与重试', icon: Shield },
  { id: 'planning', label: '规划限制', icon: GitBranch },
  { id: 'runtime', label: '运行时配置', icon: Terminal },
  { id: 'prompts', label: 'Prompt 模板', icon: FileText },
  { id: 'data', label: '数据管理', icon: Database },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard },
  { id: 'health', label: '健康检查', icon: HeartPulse },
];

// ── Confirm Dialog ───────────────────────────────────────────────

const ConfirmDialog = ({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
    <div className="w-full max-w-[400px] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 shadow-lg">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--warning)]" />
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{message}</div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            danger
              ? 'bg-[var(--error)]/10 text-[var(--error)] hover:bg-[var(--error)]/20'
              : 'bg-[var(--surface-overlay)] text-[var(--text-primary)] hover:bg-[var(--surface-input)]'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

// ── Config Section Card ──────────────────────────────────────────

const SectionCard = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-5 ${className}`}>
    {children}
  </div>
);

// ── Main View ────────────────────────────────────────────────────

export const ConfigView = (): JSX.Element => {
  const { refreshConfig, saveConfig } = useConfig();
  const { runtimeHealth, healthLoading, healthError, refreshRuntimeHealth } = useHealth();
  const agentFlow = useAgentFlow();
  const sessions = useWorkflowStore((s) => s.sessions);
  const { refreshSessions } = useSessions();

  const configSnapshot = useConfigStore((s) => s.configSnapshot);
  const configForm = useConfigStore((s) => s.configForm);
  const configLoading = useConfigStore((s) => s.configLoading);
  const configSaving = useConfigStore((s) => s.configSaving);
  const configDirty = useConfigStore((s) => s.configDirty);
  const configError = useConfigStore((s) => s.configError);
  const handleFieldChange = useConfigStore((s) => s.handleFieldChange);
  const handleToolRuntimeFieldChange = useConfigStore((s) => s.handleToolRuntimeFieldChange);
  const handlePromptTemplateChange = useConfigStore((s) => s.handlePromptTemplateChange);
  const applyConfigSnapshot = useConfigStore((s) => s.applyConfigSnapshot);

  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);

  const autoScrollEnabled = usePreferenceStore((s) => s.autoScrollEnabled);
  const setAutoScrollEnabled = usePreferenceStore((s) => s.setAutoScrollEnabled);
  const shortcuts = usePreferenceStore((s) => s.shortcuts);

  const [activeCategory, setActiveCategory] = useState('general');
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);

  const scrollTo = useCallback((id: string) => {
    setActiveCategory(id);
    const el = categoryRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  useEffect(() => {
    const container = document.querySelector('.config-scroll-container');
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.id);
          }
        }
      },
      { root: container, threshold: 0.3 }
    );

    for (const id of CATEGORIES.map((c) => c.id)) {
      const el = categoryRefs.current[id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const handleReset = async () => {
    setShowResetConfirm(false);
    if (!agentFlow) return;
    try {
      const snapshot = await agentFlow.updateConfig({});
      applyConfigSnapshot(snapshot);
      toast.success('已恢复默认设置');
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  };

  const handleClearAll = async () => {
    setShowClearConfirm(false);
    if (!agentFlow) return;
    try {
      const count = await agentFlow.clearAllSessions();
      await refreshSessions();
      toast.success(`已清除 ${count} 条历史会话`);
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  };

  const handleExportZip = async () => {
    if (!agentFlow) return;
    setExporting(true);
    try {
      const result = await agentFlow.exportAllSessionsZip();
      toast.success(`已导出到 ${result.filePath}`);
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const configSources = useMemo(() => {
    if (!configSnapshot) return [];
    const sources: { label: string; value: string; active: boolean }[] = [
      { label: '用户配置', value: configSnapshot.sources.userConfigPath, active: configSnapshot.sources.loadedFromUserConfig },
      { label: '项目配置', value: configSnapshot.sources.projectConfigPath, active: configSnapshot.sources.loadedFromProjectConfig },
    ];
    if (configSnapshot.sources.envOverrides.length > 0) {
      sources.push({ label: '环境变量', value: configSnapshot.sources.envOverrides.join(', '), active: true });
    }
    return sources;
  }, [configSnapshot]);

  const sessionCount = sessions.length;

  const toolCards = [
    {
      key: 'opencode' as const,
      title: 'OpenCode 运行时',
      cliLabel: 'OpenCode CLI 路径',
      cliPlaceholder: '留空则使用 PATH 中的 opencode',
      apiEnvLabel: 'OpenCode API Key 环境变量名',
      apiEnvPlaceholder: '默认 OPENCODE_API_KEY',
      extraEnvLabel: 'OpenCode 额外环境变量',
      extraEnvDescription: '每行 KEY=VALUE。会和 API key 一起注入；一般只在不用内嵌配置内容时才需要。',
    },
    {
      key: 'claude' as const,
      title: 'Claude 运行时',
      cliLabel: 'Claude CLI 路径',
      cliPlaceholder: '留空则使用 PATH 中的 claude',
      apiEnvLabel: 'Claude API Key 环境变量名',
      apiEnvPlaceholder: '默认 ANTHROPIC_API_KEY',
      extraEnvLabel: 'Claude 额外环境变量',
      extraEnvDescription: '每行 KEY=VALUE。适合配置 ANTHROPIC_BASE_URL、ANTHROPIC_MODEL、CLAUDE_CODE_SUBAGENT_MODEL 等第三方接入参数。',
    },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left category nav */}
      <aside className="flex h-full w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--surface-sidebar)] py-4">
        <div className="px-3 pb-3 text-2xs font-medium uppercase tracking-wider text-[var(--text-muted)]">设置分类</div>
        <nav className="space-y-0.5 px-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => scrollTo(cat.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition ${
                  active
                    ? 'bg-[var(--surface-overlay)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Icon size={14} strokeWidth={active ? 2 : 1.5} />
                {cat.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Right content */}
      <div className="config-scroll-container flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-8 py-8 pb-28">
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">设置</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">管理运行参数、模型配置和数据偏好。</p>
          </div>

          {configError ? (
            <div className="mb-6 rounded-lg border border-[var(--error)]/20 bg-[var(--error-subtle)] px-4 py-3 text-sm text-[var(--error)]">
              {configError}
            </div>
          ) : null}

          {!configForm ? (
            <p className="text-sm text-[var(--text-muted)]">加载配置中...</p>
          ) : (
            <div className="space-y-10">
              {/* ── 通用 ─────────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['general'] = el; }} id="general">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Settings size={15} className="text-[var(--text-muted)]" />
                  通用
                </h2>
                <div className="space-y-3">
                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">主题</div>
                        <div className="text-2xs text-[var(--text-muted)]">选择界面配色方案。</div>
                      </div>
                      <select
                        value={themeMode}
                        onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
                        className={`${selectClass} w-auto min-w-[120px]`}
                      >
                        <option value="system">跟随系统</option>
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                      </select>
                    </div>
                  </SectionCard>

                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">自动滚动到底部</div>
                        <div className="text-2xs text-[var(--text-muted)]">收到新消息时自动滚动到对话底部。</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoScrollEnabled}
                        onChange={(e) => setAutoScrollEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border-muted)] bg-[var(--surface-input)] text-[var(--accent)]"
                      />
                    </div>
                  </SectionCard>

                  <SectionCard>
                    <div className="text-sm text-[var(--text-primary)]">配置来源</div>
                    <div className="mt-2 space-y-1.5">
                      {configSources.map((s) => (
                        <div key={s.label} className="flex items-start gap-2 text-xs">
                          <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${s.active ? 'bg-[var(--success)]' : 'bg-[var(--text-muted)]'}`} />
                          <div className="min-w-0">
                            <span className="text-[var(--text-secondary)]">{s.label}</span>
                            <div className="truncate font-mono text-2xs text-[var(--text-muted)]">{s.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </div>
              </section>

              {/* ── AI 模型 ──────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['ai-model'] = el; }} id="ai-model">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Brain size={15} className="text-[var(--text-muted)]" />
                  AI 模型
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-sm text-[var(--text-secondary)]">Claude 强度</span>
                    <span className="block text-2xs text-[var(--text-muted)]">控制 Claude CLI 推理强度。</span>
                    <select
                      value={configForm.claudeEffort}
                      onChange={(e) => handleFieldChange('claudeEffort', e.target.value as typeof configForm.claudeEffort)}
                      className={selectClass}
                    >
                      {['low', 'medium', 'high', 'max'].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-sm text-[var(--text-secondary)]">OpenCode 变体</span>
                    <span className="block text-2xs text-[var(--text-muted)]">控制结构化 OpenCode 规划变体。</span>
                    <select
                      value={configForm.opencodeVariant}
                      onChange={(e) => handleFieldChange('opencodeVariant', e.target.value as typeof configForm.opencodeVariant)}
                      className={selectClass}
                    >
                      {['low', 'medium', 'high', 'max'].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </label>

                  <SettingsField
                    label="通过分数"
                    description="评分 >= 此值即通过验证（1–10）。"
                    value={configForm.passingScore}
                    onChange={(v) => handleFieldChange('passingScore', v)}
                  />
                </div>
              </section>

              {/* ── 超时与性能 ───────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['timeout'] = el; }} id="timeout">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Clock size={15} className="text-[var(--text-muted)]" />
                  超时与性能
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsField label="命令超时 (ms)" description="单条命令执行超时。" value={configForm.commandTimeoutMs} onChange={(v) => handleFieldChange('commandTimeoutMs', v)} />
                  <SettingsField label="健康检查超时 (ms)" value={configForm.healthTimeoutMs} onChange={(v) => handleFieldChange('healthTimeoutMs', v)} />
                  <SettingsField label="OpenCode 超时 (ms)" value={configForm.opencodeTimeoutMs} onChange={(v) => handleFieldChange('opencodeTimeoutMs', v)} />
                  <SettingsField label="预算上限 (USD)" description="留空表示无限制。仅对新工作流生效。" value={configForm.budgetCapUsd} onChange={(v) => handleFieldChange('budgetCapUsd', v)} />
                </div>
              </section>

              {/* ── 容错与重试 ───────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['resilience'] = el; }} id="resilience">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Shield size={15} className="text-[var(--text-muted)]" />
                  容错与重试
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsField label="执行重试" description="每步最大重试次数。" value={configForm.executionRetries} onChange={(v) => handleFieldChange('executionRetries', v)} />
                  <SettingsField label="JSON 修复重试" value={configForm.jsonRepairRetries} onChange={(v) => handleFieldChange('jsonRepairRetries', v)} />
                  <SettingsField label="进程重试" description="进程崩溃后重试。" value={configForm.processRetries} onChange={(v) => handleFieldChange('processRetries', v)} />
                  <SettingsField label="单步修复上限" description="每个步骤最多修复次数。" value={configForm.maxRepairAttemptsPerStep} onChange={(v) => handleFieldChange('maxRepairAttemptsPerStep', v)} />
                  <SettingsField label="总修复上限" description="整个工作流最多修复次数。" value={configForm.maxTotalRepairAttempts} onChange={(v) => handleFieldChange('maxTotalRepairAttempts', v)} />
                  <SettingsField label="退避基数 (ms)" value={configForm.backoffBaseMs} onChange={(v) => handleFieldChange('backoffBaseMs', v)} />
                  <SettingsField label="退避上限 (ms)" value={configForm.backoffMaxMs} onChange={(v) => handleFieldChange('backoffMaxMs', v)} />
                </div>
              </section>

              {/* ── 规划限制 ─────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['planning'] = el; }} id="planning">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <GitBranch size={15} className="text-[var(--text-muted)]" />
                  规划限制
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SettingsField label="最大计划步数" description="OpenCode 最多生成多少步。" value={configForm.maxPlanSteps} onChange={(v) => handleFieldChange('maxPlanSteps', v)} />
                </div>
              </section>

              {/* ── 运行时配置 ───────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['runtime'] = el; }} id="runtime">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Terminal size={15} className="text-[var(--text-muted)]" />
                  运行时配置
                </h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {toolCards.map((tool) => (
                      <SectionCard key={tool.key}>
                        <div>
                          <h3 className="text-sm font-medium text-[var(--text-primary)]">{tool.title}</h3>
                          <p className="mt-1 text-2xs text-[var(--text-muted)]">
                            为该工具单独配置 CLI、鉴权和第三方模型接入参数。留空时回退到默认命令或环境变量。
                          </p>
                        </div>
                        <div className="mt-3 space-y-3">
                          <SettingsField
                            label={tool.cliLabel}
                            description="支持绝对路径或自定义命令名。"
                            value={configForm.toolRuntimes[tool.key].cliPath}
                            placeholder={tool.cliPlaceholder}
                            onChange={(value) => handleToolRuntimeFieldChange(tool.key, 'cliPath', value)}
                          />
                          <SettingsField
                            label={tool.apiEnvLabel}
                            description="仅在填写下方 API key 时生效。"
                            value={configForm.toolRuntimes[tool.key].apiKeyEnvName}
                            placeholder={tool.apiEnvPlaceholder}
                            onChange={(value) => handleToolRuntimeFieldChange(tool.key, 'apiKeyEnvName', value)}
                          />
                          <SettingsField
                            label={`${tool.title} API Key`}
                            type="password"
                            description="会随应用配置一起保存；留空则不覆盖当前进程环境。"
                            value={configForm.toolRuntimes[tool.key].apiKey}
                            placeholder="sk-..."
                            onChange={(value) => handleToolRuntimeFieldChange(tool.key, 'apiKey', value)}
                          />
                          {tool.key === 'opencode' ? (
                            <SettingsTextArea
                              label="OpenCode 配置内容"
                              description="用于 provider/baseURL/model 等第三方模型配置。保存后会通过 OPENCODE_CONFIG_CONTENT 注入，不依赖外部 opencode.json。"
                              value={configForm.toolRuntimes.opencode.configContent}
                              placeholder={`{\n  "provider": {\n    "example": {\n      "options": {\n        "baseURL": "https://api.example.com",\n        "apiKey": "{env:OPENCODE_API_KEY}"\n      }\n    }\n  },\n  "model": "example/model-name"\n}`}
                              onChange={(value) => handleToolRuntimeFieldChange('opencode', 'configContent', value)}
                            />
                          ) : null}
                          <SettingsTextArea
                            label={tool.extraEnvLabel}
                            description={tool.extraEnvDescription}
                            value={configForm.toolRuntimes[tool.key].extraEnv}
                            placeholder={
                              tool.key === 'claude'
                                ? 'ANTHROPIC_BASE_URL=https://api.example.com/anthropic\nANTHROPIC_MODEL=provider/model-name\nCLAUDE_CODE_SUBAGENT_MODEL=provider/model-name'
                                : 'OPENAI_API_KEY=sk-...\nHTTP_PROXY=http://127.0.0.1:7890'
                            }
                            onChange={(value) => handleToolRuntimeFieldChange(tool.key, 'extraEnv', value)}
                          />
                        </div>
                      </SectionCard>
                    ))}
                  </div>

                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">启用协作执行路径</div>
                        <div className="text-2xs text-[var(--text-muted)]">允许 Claude Coordinator 多 agent 协作模式。</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={configForm.collaborationEnabled}
                        onChange={(e) => handleFieldChange('collaborationEnabled', e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border-muted)] bg-[var(--surface-input)] text-[var(--accent)]"
                      />
                    </div>
                  </SectionCard>
                </div>
              </section>

              {/* ── Prompt 模板 ──────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['prompts'] = el; }} id="prompts">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <FileText size={15} className="text-[var(--text-muted)]" />
                  Prompt 模板
                </h2>
                <div className="space-y-4">
                  {([
                    { key: 'planningInitial' as const, label: 'Planning Initial' },
                    { key: 'planningStep' as const, label: 'Planning Step' },
                    { key: 'verification' as const, label: 'Verification' },
                    { key: 'fallbackExecution' as const, label: 'Fallback Execution' },
                    { key: 'repair' as const, label: 'Repair' },
                    { key: 'coordinatorExecution' as const, label: 'Coordinator Execution' },
                    { key: 'coordinatorDispatch' as const, label: 'Coordinator Dispatch' },
                    { key: 'subAgentTask' as const, label: 'Sub-Agent Task' },
                  ]).map((t) => (
                    <SectionCard key={t.key}>
                      <SettingsTextArea
                        label={t.label}
                        value={configForm.promptTemplates[t.key]}
                        onChange={(v) => handlePromptTemplateChange(t.key, v)}
                      />
                    </SectionCard>
                  ))}
                </div>
              </section>

              {/* ── 数据管理 ─────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['data'] = el; }} id="data">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Database size={15} className="text-[var(--text-muted)]" />
                  数据管理
                </h2>
                <div className="space-y-3">
                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">自动清理过期会话</div>
                        <div className="text-2xs text-[var(--text-muted)]">超过此天数的已完成/失败会话将被自动删除。</div>
                      </div>
                      <div className="w-[140px]">
                        <SettingsField label="" value={configForm.cleanupPeriodDays} onChange={(v) => handleFieldChange('cleanupPeriodDays', v)} />
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-[var(--text-primary)]">会话历史</div>
                        <div className="text-2xs text-[var(--text-muted)]">当前共有 {sessionCount} 条会话记录。</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowClearConfirm(true)}
                          disabled={!agentFlow || sessionCount === 0}
                          className="flex items-center gap-1.5 rounded-lg border border-[var(--error)]/20 px-3 py-2 text-xs text-[var(--error)] transition hover:bg-[var(--error)]/10 disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                          清除全部
                        </button>
                        <button
                          onClick={() => void handleExportZip()}
                          disabled={!agentFlow || sessionCount === 0 || exporting}
                          className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:opacity-40"
                        >
                          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                          导出 ZIP
                        </button>
                      </div>
                    </div>
                  </SectionCard>
                </div>
              </section>

              {/* ── 快捷键 ───────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['shortcuts'] = el; }} id="shortcuts">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Keyboard size={15} className="text-[var(--text-muted)]" />
                  快捷键
                </h2>
                <SectionCard>
                  <div className="space-y-0">
                    {shortcuts.map((shortcut) => (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between border-b border-[var(--border-subtle)] py-3 last:border-0"
                      >
                        <div>
                          <div className="text-sm text-[var(--text-primary)]">{shortcut.label}</div>
                          <div className="mt-0.5 text-2xs text-[var(--text-muted)]">
                            默认: {shortcut.defaultKeys}
                          </div>
                        </div>
                        <div className="rounded-md bg-[var(--surface-overlay)] px-2.5 py-1 font-mono text-xs text-[var(--text-secondary)]">
                          {shortcut.customKeys ?? shortcut.defaultKeys}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-2xs text-[var(--text-muted)]">
                    自定义快捷键功能将在未来版本支持。
                  </p>
                </SectionCard>
              </section>

              {/* ── 健康检查 ─────────────────────────────────────── */}
              <section ref={(el) => { categoryRefs.current['health'] = el; }} id="health">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <HeartPulse size={15} className="text-[var(--text-muted)]" />
                  健康检查
                </h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs text-[var(--text-muted)]">检查各组件运行状态</span>
                    <button
                      onClick={() => void refreshRuntimeHealth()}
                      className={`flex items-center gap-1.5 ${secondaryButtonClass}`}
                      disabled={healthLoading}
                    >
                      <RotateCcw size={13} />
                      {healthLoading ? '检查中...' : '刷新'}
                    </button>
                  </div>
                  {runtimeHealth ? (
                    <div className={`rounded-lg border px-4 py-3 text-sm ${healthStatusStyles[runtimeHealth.overallStatus]}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">整体: {healthStatusLabels[runtimeHealth.overallStatus]}</span>
                        <span className="font-mono text-2xs text-[var(--text-muted)]">{runtimeHealth.checkedAt}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">等待首次健康检查。</p>
                  )}
                  {healthError ? (
                    <div className="rounded-lg border border-[var(--error)]/20 bg-[var(--error-subtle)] px-4 py-3 text-sm text-[var(--error)]">
                      {healthError}
                    </div>
                  ) : null}
                  {runtimeHealth?.checks.map((check) => (
                    <HealthCheckCard key={check.id} check={check} />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Sticky action bar */}
        <div className="sticky bottom-0 z-10 border-t border-[var(--border-subtle)] bg-[var(--bg-base)]/90 px-8 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-[720px] items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              {configDirty ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
                  有未保存的更改
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                  所有更改已保存
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]"
                disabled={configSaving}
              >
                <ResetIcon size={13} />
                恢复默认
              </button>
              <button
                onClick={() => void refreshConfig()}
                className={`flex items-center gap-1.5 ${secondaryButtonClass}`}
                disabled={configLoading || configSaving}
              >
                <RotateCcw size={13} />
                {configLoading ? '加载中...' : '重载'}
              </button>
              <button
                onClick={() => void saveConfig()}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-overlay)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:opacity-40"
                disabled={!configForm || !configDirty || configSaving}
              >
                <Save size={13} />
                {configSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showResetConfirm && (
        <ConfirmDialog
          title="恢复默认设置"
          message="确定要将所有配置恢复为默认值吗？此操作不可撤销，当前自定义配置将被覆盖。"
          confirmLabel="恢复默认"
          onConfirm={handleReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
      {showClearConfirm && (
        <ConfirmDialog
          title="清除所有历史会话"
          message={`确定要清除全部 ${sessionCount} 条历史会话吗？正在运行或排队的会话不会被删除。此操作不可撤销。`}
          confirmLabel="清除"
          danger
          onConfirm={handleClearAll}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
};
