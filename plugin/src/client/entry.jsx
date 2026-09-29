/**
 * Browser half: a "手机" entry in the left sidebar opening the pairing page — QR for a new phone,
 * the 6-digit confirmation, paired devices, away mode and the pending approvals queue.
 */
import React from 'react';
import { CSS } from './styles.js';

const PKG = '@local/dsh-pair';
const NS = 'local-pair';
const PANEL_ID = 'local-pair';

export const inject = ['slots', 'locale'];

const url = (path) => new URL('api/pair' + path, document.baseURI);
async function call(method, path, body, signal) {
  const init = { method, credentials: 'same-origin', signal, headers: {} };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const response = await fetch(url(path), init);
  let data;
  try { data = await response.json(); } catch { data = undefined; }
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data;
}

function PhoneIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

function ago(ms) {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(ms).toLocaleDateString();
}

function useState() {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const revision = React.useRef(-1);
  const reload = React.useCallback(async () => {
    try { const next = await call('GET', '/state'); revision.current = next.revision; setData(next); setError(null); } catch (e) { setError(e.message); }
  }, []);
  React.useEffect(() => {
    let stop = false;
    const abort = new AbortController();
    (async () => {
      await reload();
      while (!stop) {
        try {
          const { revision: rev } = await call('GET', `/wait?revision=${revision.current}`, undefined, abort.signal);
          if (rev !== revision.current) await reload();
        } catch {
          if (stop) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => { stop = true; abort.abort(); };
  }, [reload]);
  return [data, error, setData];
}

function Switch({ on, onChange, disabled }) {
  return <button type="button" role="switch" aria-checked={on} className={`px-switch${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

function Countdown({ until }) {
  const [, tick] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => { const t = setInterval(tick, 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((until - Date.now()) / 1000));
  return <span>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>;
}

function PairCard({ data, act, busy }) {
  const { offer, request } = data.pairing;
  const [copied, setCopied] = React.useState(false);
  if (request) {
    return (
      <div className="px-card px-confirm">
        <div className="px-confirm-head"><PhoneIcon size={22} /><div><b>「{request.name}」请求配对</b><span>确认手机上显示的核对码与下面一致，再点允许。</span></div></div>
        <div className="px-sas">{request.sas.slice(0, 3)}<i /> {request.sas.slice(3)}</div>
        <div className="px-row-actions">
          <button type="button" className="px-btn" disabled={busy} onClick={() => act('POST', '/decide', { allow: false })}>拒绝</button>
          <button type="button" className="px-btn primary" disabled={busy} onClick={() => act('POST', '/decide', { allow: true })}>允许连接</button>
        </div>
      </div>
    );
  }
  if (offer) {
    return (
      <div className="px-card px-offer">
        <div className="px-qr" dangerouslySetInnerHTML={{ __html: offer.qr }} />
        <div className="px-offer-text">
          <b>用 iPhone 相机扫描二维码</b>
          <ol>
            <li>第一次使用：先用 Safari 打开 <code>{new URL(data.relay.url).host}</code>，点「分享 → 添加到主屏幕」，再从主屏幕 App 里扫码，这样才能收到通知。</li>
            <li>扫码后手机会显示 6 位核对码，这里会弹出确认。</li>
          </ol>
          <div className="px-muted">二维码只能用一次，<Countdown until={offer.expiresAt} /> 后失效。</div>
          <div className="px-row-actions">
            <button type="button" className="px-btn sm" onClick={async () => { await navigator.clipboard.writeText(offer.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? '已复制' : '复制配对链接'}</button>
            <button type="button" className="px-btn sm ghost" disabled={busy} onClick={() => act('POST', '/cancel')}>取消</button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function Pending({ items, act, busy }) {
  if (!items.length) return null;
  return (
    <section className="px-section">
      <div className="px-section-head"><h2>等待处理</h2><span className="px-count">{items.length}</span></div>
      <div className="px-list">
        {items.map((item) => (
          <div key={item.id} className="px-item">
            <div className="px-item-main">
              <b>{item.kind === 'approval' ? `审批：${item.toolName}` : '提问'}</b>
              <span>{item.sessionTitle ?? item.sessionId}{item.reason ? ` · ${item.reason}` : ''}{item.kind === 'question' ? ` · ${item.questions?.[0]?.question ?? ''}` : ''}</span>
            </div>
            {item.kind === 'approval' ? (
              <div className="px-row-actions">
                <button type="button" className="px-btn sm danger" disabled={busy} onClick={() => act('POST', '/answer', { id: item.id, decision: 'reject' })}>拒绝</button>
                <button type="button" className="px-btn sm primary" disabled={busy} onClick={() => act('POST', '/answer', { id: item.id, decision: 'allow' })}>允许一次</button>
              </div>
            ) : <span className="px-muted">请在手机上回答</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function PairPage() {
  const [data, error, setData] = useState();
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState(null);
  const act = async (method, path, body) => {
    setBusy(true); setActionError(null);
    try { setData(await call(method, path, body)); } catch (e) { setActionError(e.message); } finally { setBusy(false); }
  };
  const testPush = async (deviceId) => {
    setActionError(null);
    try { const r = await call('POST', '/test-push', { deviceId }); if (!r.sent) setActionError(r.reason === 'no-subscription' ? '这台手机还没有开启通知（在手机 App 的设置里打开）' : `推送失败：${r.reason}`); } catch (e) { setActionError(e.message); }
  };
  const status = data?.relay.status;
  return (
    <div className="px-page">
      <div className="px-inner">
        <header className="px-head">
          <div>
            <h1>手机</h1>
            <p>在手机上查看会话、发消息、停止任务、审批操作，并在完成或需要你时收到通知。通信经 Cloudflare 中继转发，全程端到端加密，中继看不到内容。</p>
          </div>
          {data ? (
            <span className="px-status"><span className={`px-dot ${status === 'online' ? 'ok' : status === 'connecting' ? 'busy' : 'err'}`} />{status === 'online' ? '中继已连接' : status === 'connecting' ? '正在连接中继…' : '中继未连接'}</span>
          ) : null}
        </header>

        {error ? <div className="px-note err">{error}</div> : null}
        {actionError ? <div className="px-note err">{actionError}</div> : null}
        {!data ? <div className="px-empty">加载中…</div> : (
          <>
            {data.pairing.offer || data.pairing.request ? <PairCard data={data} act={act} busy={busy} /> : null}

            <Pending items={data.pending} act={act} busy={busy} />

            <section className="px-section">
              <div className="px-section-head">
                <h2>已配对的手机</h2><span className="px-count">{data.devices.length}</span>
                <span className="px-grow" />
                {!data.pairing.offer && !data.pairing.request ? <button type="button" className="px-btn primary" disabled={busy} onClick={() => act('POST', '/start')}><PhoneIcon size={15} />配对新手机</button> : null}
              </div>
              {data.devices.length === 0 ? (
                <div className="px-empty"><span className="px-empty-icon"><PhoneIcon size={22} /></span><b>还没有配对的手机</b><span>点「配对新手机」，用手机扫码即可。</span></div>
              ) : (
                <div className="px-list">
                  {data.devices.map((d) => (
                    <div key={d.id} className="px-item">
                      <span className={`px-dot ${d.online ? 'ok' : ''}`} />
                      <div className="px-item-main">
                        <b>{d.name}</b>
                        <span>{d.online ? '在线' : `上次在线 ${ago(d.lastSeen)}`} · {d.push ? '通知已开启' : '通知未开启'} · 配对于 {new Date(d.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="px-row-actions">
                        {d.push ? <button type="button" className="px-btn sm ghost" onClick={() => testPush(d.id)}>测试通知</button> : null}
                        <button type="button" className="px-btn sm danger" disabled={busy} onClick={() => { if (confirm(`移除「${d.name}」？它将无法再连接这台电脑。`)) act('POST', '/revoke', { deviceId: d.id }); }}>移除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="px-section">
              <div className="px-section-head"><h2>离开模式</h2></div>
              <div className="px-card px-away">
                <div className="px-item-main">
                  <b>{data.away.on ? '离开中：审批和提问会发到手机' : '在电脑前'}</b>
                  <span>开启后，正在运行的会话会临时切换到「{data.away.preset}」权限（写工作区外的文件或执行高风险命令前需要审批），审批和提问改由手机处理，{data.away.on ? `已切换 ${data.away.sessions} 个会话。` : '关闭后恢复原来的权限。'}未处理的审批 30 分钟后自动拒绝。</span>
                </div>
                <Switch on={data.away.on} disabled={busy || data.devices.length === 0} onChange={(on) => act('POST', '/away', { on })} />
              </div>
            </section>

            <div className="px-foot">中继：{data.relay.url} · 设备 ID {data.desktopId}</div>
          </>
        )}
      </div>
    </div>
  );
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh: { panel: '手机' }, en: { panel: 'Phone' } }), 'dsh-pair: dictionary');
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.plugin = PKG;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, 'dsh-pair: styles');
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PairPage)), 'dsh-pair: page');
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 15, locale: NS, label: () => t('panel'),
  }, PhoneIcon)), 'dsh-pair: sidebar entry');
}
