import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  RefreshCw,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import type { ModelQuotaInfo, ProviderState } from '@voragent/shared';
import { PROVIDER_MODELS } from '@voragent/shared';
import { api, errText } from './api';
import { ProviderIcon } from './components/ProviderIcon';
import { CustomSelect, type SelectOption } from './components/CustomSelect';

export type Light = 'green' | 'yellow' | 'red' | 'grey';

const hhmm = (ms: number): string =>
  new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Màu và chữ của một ô nền tảng. `usedPercent` là tỉ lệ 0..1. */
export function describeProvider(p: ProviderState, now: number): { light: Light; note: string } {
  if (!p.installed) return { light: 'grey', note: 'chưa cài' };
  if (p.cooldownUntil !== null && p.cooldownUntil > now) {
    return { light: 'red', note: `tạm nghỉ đến ${hhmm(p.cooldownUntil)}` };
  }
  if (p.usedPercent !== null && p.usedPercent >= 0.9) {
    return { light: 'yellow', note: `đã dùng ${Math.round(p.usedPercent * 100)}%` };
  }
  const note = p.usedPercent !== null ? `đã dùng ${Math.round(p.usedPercent * 100)}%` : 'sẵn sàng';
  return { light: 'green', note };
}

interface ProviderInstallGuide {
  id: string;
  title: string;
  vendor: string;
  npmPackage: string | null;
  installCmd: string;
  authCmd: string;
  verifyCmd: string;
  docsUrl: string;
  notes: string[];
}

function getProviderGuide(providerId: string): ProviderInstallGuide {
  const key = providerId.toLowerCase();
  if (key.includes('codex')) {
    return {
      id: 'codex',
      title: 'OpenAI Codex CLI',
      vendor: 'OpenAI',
      npmPackage: '@openai/codex',
      installCmd: 'npm install -g @openai/codex',
      authCmd: 'codex',
      verifyCmd: 'codex --version',
      docsUrl: 'https://github.com/openai/codex',
      notes: [
        'Yêu cầu máy đã cài sẵn Node.js (khuyến nghị Node.js >= 18) và npm.',
        'Sau khi cài đặt xong, mở Terminal chạy lệnh "codex" lần đầu để đăng nhập tài khoản ChatGPT Plus/Pro/Team hoặc thiết lập biến môi trường OPENAI_API_KEY.',
      ],
    };
  }
  if (key.includes('claude')) {
    return {
      id: 'claude',
      title: 'Anthropic Claude Code CLI',
      vendor: 'Anthropic',
      npmPackage: '@anthropic-ai/claude-code',
      installCmd: 'npm install -g @anthropic-ai/claude-code',
      authCmd: 'claude',
      verifyCmd: 'claude --version',
      docsUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview',
      notes: [
        'Yêu cầu Node.js >= 18 và npm.',
        'Sau khi cài đặt, chạy lệnh "claude" trong Terminal để hoàn tất bước đăng nhập xác thực OAuth trên trình duyệt.',
      ],
    };
  }
  if (key.includes('opencode')) {
    return {
      id: 'opencode',
      title: 'OpenCode CLI',
      vendor: 'Anomaly Innovations',
      npmPackage: '@opencode/cli',
      installCmd: 'npm install -g @opencode/cli',
      authCmd: 'opencode auth login',
      verifyCmd: 'opencode --version',
      docsUrl: 'https://github.com/anomalyco/opencode',
      notes: [
        'OpenCode là CLI mã nguồn mở hỗ trợ đa nền tảng (OpenRouter, Google Gemini, Groq, GitHub Copilot...).',
        'Sau khi cài đặt, mở Terminal chạy lệnh "opencode auth login" hoặc "opencode auth" để kết nối các nhà cung cấp mô hình.',
      ],
    };
  }
  return {
    id: 'antigravity',
    title: 'Google Antigravity CLI (agy)',
    vendor: 'Google DeepMind',
    npmPackage: null,
    installCmd: 'agy --version',
    authCmd: 'agy login',
    verifyCmd: 'agy --version',
    docsUrl: 'https://idx.dev',
    notes: [
      'Antigravity CLI (lệnh "antigravity" hoặc "agy") được cài đặt tự động cùng bộ công cụ Google Antigravity IDE.',
      'Hãy đảm bảo thư mục chứa file thực thi "agy" hoặc "antigravity" đã được thêm vào biến môi trường PATH của hệ điều hành.',
    ],
  };
}

function CommandCopyRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          background: '#1E1D1A',
          color: '#FAF8F5',
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid #33302B',
          fontFamily: 'var(--font-mono)',
          fontSize: '12.5px',
        }}
      >
        <code style={{ color: '#FDE68A', userSelect: 'all' }}>{command}</code>
        <button
          type="button"
          className="icon-btn-sm"
          onClick={handleCopy}
          data-tooltip={copied ? 'Đã sao chép lệnh!' : 'Sao chép lệnh'}
          style={{
            background: 'rgba(255,255,255,0.1)',
            borderColor: 'rgba(255,255,255,0.18)',
            color: '#FAF8F5',
            width: '26px',
            height: '26px',
          }}
        >
          {copied ? <Check size={13} color="#34D399" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

export function QuotaBar({
  providers,
  now,
  onProvidersUpdated,
}: {
  providers: ProviderState[];
  now: number;
  onProvidersUpdated?: (next: ProviderState[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [guideProviderId, setGuideProviderId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let live = true;
    void api.config().then((cfg) => {
      if (live) {
        if (cfg.models) setConfigModels(cfg.models);
        if (cfg.modelFallbackPolicy) setFallbackPolicy(cfg.modelFallbackPolicy);
      }
    }).catch(() => undefined);

  return () => { live = false; };
  }, []);



  const [installError, setInstallError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState<string | null>(null);
  const [configModels, setConfigModels] = useState<Record<string, string>>({});
  const [fallbackPolicy, setFallbackPolicy] = useState<'auto' | 'ask'>('auto');
  const [modelQuotasMap, setModelQuotasMap] = useState<Record<string, ModelQuotaInfo[]>>({});
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [probeFeedbacks, setProbeFeedbacks] = useState<Record<string, { ok: boolean; note: string }>>({});
  const ref = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);

  const updatePopoverPos = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPopoverPos({
      top: rect.bottom + 8,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePopoverPos();
    window.addEventListener('resize', updatePopoverPos);
    window.addEventListener('scroll', updatePopoverPos, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPos);
      window.removeEventListener('scroll', updatePopoverPos, true);
    };
  }, [open, updatePopoverPos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('.custom-select-dropdown') ||
        target.closest('.custom-select-container') ||
        target.closest('.confirm-modal-overlay') ||
        target.closest('.quota-popover-menu')
      ) {
        return;
      }
      if (ref.current && !ref.current.contains(target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);

  return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

    const loadModelQuotas = async () => {
    try {
      const q = await api.modelQuotas();
      setModelQuotasMap(q);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open) {
      void loadModelQuotas();
      // Tự động kiểm tra/đo quota của các model đang chọn khi mở popover
      for (const p of providers) {
        if (!p.installed) continue;
        const provKey = p.id.toLowerCase();
        const models = PROVIDER_MODELS[provKey] ?? [];
        if (models.length === 0) continue;
        const cur = configModels[provKey] || models.find((m) => m.default)?.id || models[0]?.id;
        if (cur) {
          void handleProbeModel(provKey, cur);
        }
      }
    }
  }, [open]);

  const handleProbeModel = async (provider: string, model: string) => {
    const key = `${provider}:${model}`;
    setProbingKey(key);
    try {
      const res = await api.probeModelQuota(provider, model);
      setProbeFeedbacks((prev) => ({ ...prev, [key]: { ok: res.ok, note: res.note } }));
      await loadModelQuotas();
    } catch (e) {
      setProbeFeedbacks((prev) => ({ ...prev, [key]: { ok: false, note: `Lỗi: ${errText(e)}` } }));
    } finally {
      setProbingKey(null);
    }
  };

  const handleUpdateFallbackPolicy = async (policy: 'auto' | 'ask') => {
    setFallbackPolicy(policy);
    try {
      await api.updateConfig({ modelFallbackPolicy: policy });
    } catch (err) {
      console.error('Failed to update fallback policy:', err);
    }
  };

  const handleRefreshProviders = async () => {
    setRefreshing(true);
    setInstallError(null);
    try {
      const next = await api.refreshProviders();
      onProvidersUpdated?.(next);
      const found = guideProviderId ? next.find((p) => p.id === guideProviderId) : null;
      if (found?.installed) {
        setInstallSuccess(`Đã nhận diện ${found.id.toUpperCase()} (v${found.version ?? 'mới nhất'}) sẵn sàng hoạt động!`);
      }
    } catch (e) {
      setInstallError(errText(e));
    } finally {
      setRefreshing(false);
      void loadModelQuotas();
    }
  };

  const handleResetCooldown = async (provider: string) => {
    try {
      await api.resetProviderCooldown(provider);
      await handleRefreshProviders();
    } catch (err) {
      console.error('Failed to reset provider cooldown:', err);
    }
  };

  const handleUpdateGlobalModel = async (provider: string, model: string) => {
    const key = provider.toLowerCase();
    const updated = { ...configModels, [key]: model };
    setConfigModels(updated);
    try {
      const res = await api.updateConfig({ models: updated });
      if (res.models) {
        setConfigModels(res.models);
      }
      try {
        if (key === 'antigravity') {
          await api.resetModelCooldown(key, model);
        } else {
          await api.resetProviderCooldown(key);
        }
      } catch { /* ignore */ }
      // Tự động kiểm tra/đo quota của model mới ngay lập tức
      void handleProbeModel(key, model);
      await handleRefreshProviders();
      await loadModelQuotas();
    } catch (err) {
      console.error('Failed to update global model:', err);
    }
  };

  const handleAutoInstall = async (providerId: string) => {
    setInstalling(true);
    setInstallError(null);
    setInstallSuccess(null);
    try {
      const res = await api.installProvider(providerId);
      onProvidersUpdated?.(res.providers);
      const updated = res.providers.find((p) => p.id === providerId);
      if (updated?.installed) {
        setInstallSuccess(`Cài đặt thành công ${res.package} (v${updated.version ?? 'mới nhất'})! Công cụ đã sẵn sàng.`);
      } else {
        setInstallSuccess(`Đã chạy lệnh cài đặt ${res.package}. Hãy thực hiện thêm bước đăng nhập xác thực bên dưới nếu cần.`);
      }
    } catch (e) {
      setInstallError(errText(e));
    } finally {
      setInstalling(false);
    }
  };

  const openGuideModal = (providerId: string) => {
    setOpen(false);
    setInstallError(null);
    setInstallSuccess(null);
    setGuideProviderId(providerId);
  };

  if (providers.length === 0) {
    return null;
  }

  const installedCount = providers.filter((p) => p.installed).length;
  const described = providers.map((p) => ({ p, d: describeProvider(p, now) }));

  const activeGuideProvider = guideProviderId
    ? providers.find((p) => p.id === guideProviderId) ?? null
    : null;
  const guide = activeGuideProvider ? getProviderGuide(activeGuideProvider.id) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }} aria-label="Hạn mức nền tảng">
      <button
        type="button"
        className="quota-compact-trigger"
        onClick={() => setOpen((v) => !v)}
        data-tooltip="Bấm để xem chi tiết hạn mức (Quota) & cài đặt các Agent CLI"
        data-tooltip-placement="bottom"
      >
        <Cpu size={14} style={{ color: 'var(--text-secondary)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {described.map(({ p, d }) => (
            <span
              key={p.id}
              className={`quota-pill-indicator ${d.light}`}
              data-tooltip={`${p.id}: ${d.note}`}
            />
          ))}
        </div>
        <span className="quota-trigger-text" style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          <span className="quota-counts tabular">{installedCount}/{providers.length}</span>
          <span className="quota-label"> CLI</span>
        </span>
        <ChevronDown size={13} style={{ color: 'var(--text-secondary)' }} />
      </button>

      {open && popoverPos && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="quota-popover-menu is-portal"
            style={{
              position: 'fixed',
              top: `${popoverPos.top}px`,
              right: `${popoverPos.right}px`,
              zIndex: 99999,
            }}
            role="dialog" aria-label="Chi tiết trạng thái và hạn mức Agent CLI">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              TRẠNG THÁI &amp; HẠN MỨC CÁC AGENT CLI
            </span>
            <button
              type="button"
              className="icon-btn-sm"
              onClick={() => { void handleRefreshProviders(); }}
              disabled={refreshing}
              data-tooltip="Kiểm tra lại trạng thái cài đặt các CLI"
              aria-label="Làm mới trạng thái CLI"
              style={{ width: '24px', height: '24px', minHeight: '24px' }}
            >
              <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {described.map(({ p, d }) => {
              const pct = p.usedPercent !== null ? Math.min(100, Math.round(p.usedPercent * 100)) : null;
              const isUninstalled = !p.installed;


  return (
                <div
                  key={p.id}
                  className={`quota-popover-item ${isUninstalled ? 'is-uninstalled' : ''}`}
                  onClick={isUninstalled ? () => openGuideModal(p.id) : undefined}
                  role={isUninstalled ? 'button' : undefined}
                  tabIndex={isUninstalled ? 0 : undefined}
                  onKeyDown={
                    isUninstalled
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openGuideModal(p.id);
                          }
                        }
                      : undefined
                  }
                  data-tooltip={
                    isUninstalled
                      ? `Bấm để cài đặt tự động hoặc xem hướng dẫn cài ${p.id.toUpperCase()}`
                      : undefined
                  }
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`quota-pill-indicator ${d.light}`} />
                      <ProviderIcon provider={p.id} size={13} />
                      <strong style={{ fontSize: '13px', textTransform: 'capitalize' }}>{p.id}</strong>
                      {p.version && <span className="muted" style={{ fontSize: '11px' }}>v{p.version}</span>}
                    </div>
                    {isUninstalled ? (
                      <span className="quota-install-cta">
                        <Download size={11} />
                        <span>Cài đặt</span>
                      </span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="quota-pill-note" style={{ fontSize: '12px' }}>{d.note}</span>
                        {p.cooldownUntil !== null && p.cooldownUntil > Date.now() && (
                          <button
                            type="button"
                            className="office-mini-btn"
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              height: '22px',
                              minHeight: '22px',
                              borderRadius: '6px',
                              backgroundColor: '#FEF3C7',
                              borderColor: '#F59E0B',
                              color: '#92400E',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'pointer',
                            }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleResetCooldown(p.id);
                            }}
                            data-tooltip="Bỏ tạm nghỉ & kích hoạt lại Agent ngay bây giờ"
                          >
                            <Zap size={11} />
                            <span>Kích hoạt lại</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {pct !== null && (
                    <div className="quota-pill-bar" style={{ width: '100%', marginTop: '6px' }}>
                      <div
                        className={`quota-pill-bar-fill ${d.light}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}

                  {p.installed && (() => {
                    const provKey = p.id.toLowerCase();
                    const models = PROVIDER_MODELS[provKey] ?? [];
                    if (models.length === 0) return null;
                    const cur = configModels[provKey] || models.find((m) => m.default)?.id || models[0]?.id;
                    const quotas = modelQuotasMap[provKey] ?? [];
                    const isAnti = provKey === 'antigravity';
                    const probeKey = `${provKey}:${cur}`;
                    const curQuotaInfo = quotas.find((q) => q.model === cur);

                    const modelOpts: SelectOption[] = models.map((m) => {
                      const qInfo = quotas.find((q) => q.model === m.id);
                      let badge = m.default ? 'Mặc định' : undefined;
                      let badgeType: 'info' | 'warn' | 'success' | 'default' = m.default ? 'info' : 'default';

                      if (isAnti) {
                        if (qInfo?.status === 'cooldown' && qInfo.cooldownUntil) {
                          badge = `⏳ Tạm nghỉ đến ${hhmm(qInfo.cooldownUntil)}`;
                          badgeType = 'warn';
                        } else {
                          badge = '🟢 Còn quota';
                          badgeType = 'success';
                        }
                      } else {
                        // Shared quota for Claude & Codex
                        if (p.cooldownUntil !== null && p.cooldownUntil > now) {
                          badge = '⏳ Tạm nghỉ';
                          badgeType = 'warn';
                        } else if (pct !== null) {
                          badge = `Dùng chung ${pct}%`;
                        } else {
                          badge = 'Dùng chung';
                        }
                      }

                      return {
                        value: m.id,
                        label: m.name,
                        sublabel: isAnti
                          ? `${m.description} • Quota độc lập`
                          : `${m.description} • Dùng chung quota ${p.id}`,
                        badge,
                        badgeType,
                      };
                    });


  return (
                      <div
                        style={{
                          marginTop: '6px',
                          paddingTop: '6px',
                          borderTop: '1px dashed var(--border-subtle)',
                          fontSize: '11px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            <Cpu size={12} color="var(--amber-base)" /> Model:
                          </span>
                          <div style={{ flex: 1, minWidth: '190px' }}>
                            <CustomSelect
                              options={modelOpts}
                              value={cur || ''}
                              onChange={(val) => {
                                void handleUpdateGlobalModel(provKey, val);
                              }}
                              searchable={false}
                            />
                          </div>
                        </div>

                        {/* Trạng thái hạn mức model & Tùy chọn chuyển model tự động (chỉ dành riêng cho Antigravity) */}
                        {isAnti ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10.5px', marginTop: '2px', padding: '0 2px' }}>
                              <span style={{
                                color: curQuotaInfo?.status === 'cooldown' ? '#D97706' : '#059669',
                                fontWeight: 500,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}>
                                {probingKey === probeKey ? (
                                  <>
                                    <RefreshCw size={10} className="spin" />
                                    <span>Đang kiểm tra quota...</span>
                                  </>
                                ) : curQuotaInfo?.status === 'cooldown' && curQuotaInfo.cooldownUntil ? (
                                  <>
                                    <Clock size={11} color="#D97706" />
                                    <span>Tạm nghỉ đến {hhmm(curQuotaInfo.cooldownUntil)}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="quota-pill-indicator green" style={{ width: '6px', height: '6px', display: 'inline-block' }} />
                                    <span>Hạn mức độc lập, sẵn sàng</span>
                                  </>
                                )}
                              </span>
                              {curQuotaInfo?.status === 'cooldown' && (
                                <span style={{ fontSize: '10px', color: 'var(--amber-dark, #B45309)', fontWeight: 500 }}>
                                  (Gợi ý: Gemini 3.8 Flash)
                                </span>
                              )}
                            </div>

                            {/* Tùy chọn xử lý khi hết quota thu gọn dạng Capsule Switcher */}
                            <div className="quota-fallback-row">
                              <span className="quota-fallback-label">
                                Khi hết quota:
                              </span>
                              <div className="quota-fallback-switcher" role="radiogroup" aria-label="Xử lý khi hết quota">
                                <button
                                  type="button"
                                  className={`quota-fallback-btn ${fallbackPolicy === 'auto' ? 'active' : ''}`}
                                  onClick={() => void handleUpdateFallbackPolicy('auto')}
                                  role="radio"
                                  aria-checked={fallbackPolicy === 'auto'}
                                  data-tooltip="Tự động chuyển sang model còn quota (ví dụ: Gemini 3.8 Flash) để tiếp tục công việc"
                                >
                                  <Zap size={11} className="fallback-icon-zap" />
                                  <span>Tự đổi model</span>
                                </button>
                                <button
                                  type="button"
                                  className={`quota-fallback-btn ${fallbackPolicy === 'ask' ? 'active' : ''}`}
                                  onClick={() => void handleUpdateFallbackPolicy('ask')}
                                  role="radio"
                                  aria-checked={fallbackPolicy === 'ask'}
                                  data-tooltip="Tạm dừng task và hiển thị thông báo để bạn quyết định đổi model hay dừng hẳn"
                                >
                                  <Clock size={11} className="fallback-icon-pause" />
                                  <span>Chờ duyệt</span>
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', padding: '0 2px' }}>
                            <span>
                              {probingKey === probeKey ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  <RefreshCw size={9} className="spin" /> Đang kiểm tra...
                                </span>
                              ) : (
                                `Dùng chung quota ${p.id.toUpperCase()}`
                              )}
                            </span>
                            {p.cooldownUntil !== null && p.cooldownUntil > now && (
                              <span style={{ color: '#D97706', fontWeight: 500 }}>⏳ Đang tạm nghỉ</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}

      {/* MODAL CÀI ĐẶT TỰ ĐỘNG & HƯỚNG DẪN CHI TIẾT CHO AGENT CLI CHƯA CÀI */}
      {activeGuideProvider && guide && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="office-modal-backdrop"
            onClick={() => !installing && setGuideProviderId(null)}
            role="dialog"
            aria-modal="true"
            aria-label={`Hướng dẫn cài đặt ${guide.title}`}
          >
            <div
              className="office-modal-dialog"
              style={{ width: 'min(560px, 94vw)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="office-side-panel" style={{ padding: '18px 22px' }}>
                <div className="office-side-header" style={{ marginBottom: '14px', paddingBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <ProviderIcon provider={activeGuideProvider.id} size={24} />
                    <div>
                      <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>Cài đặt {guide.title}</span>
                        {activeGuideProvider.installed ? (
                          <span className="badge success">
                            <CheckCircle2 size={11} /> Đã cài đặt
                          </span>
                        ) : (
                          <span className="badge warn">Chưa cài đặt</span>
                        )}
                      </h3>
                      <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
                        Nhà cung cấp: {guide.vendor} · Tích hợp trực tiếp với voragent
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn-sm"
                    disabled={installing}
                    onClick={() => setGuideProviderId(null)}
                    data-tooltip="Đóng cửa sổ (Esc)"
                    aria-label="Đóng"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="office-side-scroll" style={{ gap: '14px' }}>
                  {installSuccess && (
                    <div
                      style={{
                        background: 'var(--green-bg)',
                        border: '1px solid var(--green-border)',
                        color: 'var(--green-text)',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <CheckCircle2 size={16} />
                      <span>{installSuccess}</span>
                    </div>
                  )}

                  {installError && (
                    <div className="error" style={{ margin: 0, fontSize: '12.5px' }}>
                      {installError}
                    </div>
                  )}

                  {/* Khối 1: Cài đặt tự động 1-Click (nếu hỗ trợ qua npm) */}
                  {guide.npmPackage && !activeGuideProvider.installed && (
                    <div
                      style={{
                        background: '#FFFDF7',
                        border: '1px solid var(--amber-border)',
                        borderRadius: '10px',
                        padding: '14px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                            ⚡ Cài đặt tự động 1-Click qua npm
                          </div>
                          <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
                            Hệ thống sẽ tự động chạy <code>{guide.installCmd}</code> trên máy của bạn.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="primary"
                          disabled={installing}
                          onClick={() => { void handleAutoInstall(activeGuideProvider.id); }}
                          style={{ height: '34px', minHeight: '34px', padding: '0 14px', fontSize: '12.5px', flexShrink: 0 }}
                        >
                          <Download size={14} />
                          <span>{installing ? 'Đang cài đặt qua npm…' : `Cài đặt ${guide.id.toUpperCase()} ngay`}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Khối 2: Hướng dẫn cài đặt & xác thực thủ công từng bước */}
                  <div
                    style={{
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '10px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Terminal size={14} />
                      <span>Hướng dẫn cài đặt &amp; đăng nhập qua Terminal</span>
                    </div>

                    <CommandCopyRow
                      label="Bước 1: Chạy lệnh cài đặt trong Terminal (PowerShell / CMD)"
                      command={guide.installCmd}
                    />

                    <CommandCopyRow
                      label="Bước 2: Khởi chạy lần đầu để đăng nhập xác thực tài khoản"
                      command={guide.authCmd}
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                      {guide.notes.map((note, idx) => (
                        <div key={idx} style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          • {note}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Thanh hành động cuối Modal */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '4px' }}>
                    <a
                      href={guide.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--primary)',
                        textDecoration: 'none',
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>Tài liệu chính thức từ {guide.vendor}</span>
                    </a>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => { void handleRefreshProviders(); }}
                        disabled={refreshing || installing}
                        style={{ height: '34px', minHeight: '34px', fontSize: '12.5px' }}
                      >
                        <RefreshCw size={13} className={refreshing ? 'spin' : ''} />
                        <span>{refreshing ? 'Đang kiểm tra…' : 'Kiểm tra lại trạng thái'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGuideProviderId(null)}
                        disabled={installing}
                        style={{ height: '34px', minHeight: '34px', fontSize: '12.5px' }}
                      >
                        Đóng
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}