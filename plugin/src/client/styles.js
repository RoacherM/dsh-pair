import { baseCss } from './base.js';

const fg = 'var(--dsw-alias-label-primary)', fg2 = 'var(--dsw-alias-label-secondary)', fg3 = 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))';
const l1 = 'var(--dsw-alias-bg-layer-1)', l2 = 'var(--dsw-alias-bg-layer-2)';
const line = 'var(--dsw-alias-border-l1)';

export const CSS = baseCss('px') + `
.px-card { display:flex; gap:20px; align-items:center; padding:18px 20px; border-radius:14px; background:${l1}; box-shadow:0 0 0 1px ${line}, 0 1px 2px rgba(0,0,0,.03); }
.px-list { border-radius:14px; background:${l1}; box-shadow:0 0 0 1px ${line}, 0 1px 2px rgba(0,0,0,.03); overflow:hidden; }
.px-item { display:flex; align-items:center; gap:14px; padding:14px 18px; }
.px-item + .px-item { border-top:1px solid ${line}; }
.px-item-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.px-item-main b { font-size:14px; font-weight:600; letter-spacing:-.01em; }
.px-item-main span { font-size:12.5px; color:${fg2}; line-height:1.55; }
.px-row-actions { display:flex; gap:8px; flex:none; align-items:center; }
.px-muted { font-size:12px; color:${fg3}; }
.px-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:40px 20px; border-radius:14px; background:${l1}; box-shadow:0 0 0 1px ${line}; color:${fg2}; text-align:center; }
.px-empty b { color:${fg}; font-size:14px; }
.px-empty-icon { display:grid; place-items:center; width:44px; height:44px; margin-bottom:4px; border-radius:12px; background:${l2}; color:${fg2}; }
.px-offer { align-items:flex-start; }
.px-qr { flex:none; width:220px; height:220px; padding:10px; border-radius:12px; background:#fff; box-shadow:0 0 0 1px ${line}; }
.px-qr svg { width:100%; height:100%; display:block; }
.px-offer-text { display:flex; flex-direction:column; gap:10px; font-size:13px; color:${fg2}; }
.px-offer-text b { color:${fg}; font-size:16px; font-weight:600; letter-spacing:-.01em; }
.px-offer-text ol { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px; line-height:1.6; }
.px-offer-text code { padding:1px 5px; border-radius:5px; background:${l2}; font-size:12px; color:${fg}; }
.px-confirm { flex-direction:column; align-items:stretch; }
.px-confirm-head { display:flex; gap:12px; align-items:flex-start; }
.px-confirm-head div { display:flex; flex-direction:column; gap:3px; }
.px-confirm-head b { font-size:15px; }
.px-confirm-head span { color:${fg2}; font-size:12.5px; }
.px-sas { font-size:44px; font-weight:650; letter-spacing:.12em; text-align:center; font-variant-numeric:tabular-nums; padding:8px 0; }
.px-sas i { display:inline-block; width:10px; }
.px-confirm .px-row-actions { justify-content:flex-end; }
.px-away { gap:24px; }
.px-foot { font-size:11.5px; color:${fg3}; }
`;
