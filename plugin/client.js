window.__ModuleLoader__.load({
  id: "@local/dsh-pair",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var D=Object.create;var h=Object.defineProperty;var E=Object.getOwnPropertyDescriptor;var I=Object.getOwnPropertyNames;var M=Object.getPrototypeOf,O=Object.prototype.hasOwnProperty;var L=(e,t)=>{for(var i in t)h(e,i,{get:t[i],enumerable:!0})},N=(e,t,i,o)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of I(t))!O.call(e,s)&&s!==i&&h(e,s,{get:()=>t[s],enumerable:!(o=E(t,s))||o.enumerable});return e};var R=(e,t,i)=>(i=e!=null?D(M(e)):{},N(t||!e||!e.__esModule?h(i,"default",{value:e,enumerable:!0}):i,e)),A=e=>N(h({},"__esModule",{value:!0}),e);var Q={};L(Q,{apply:()=>X,inject:()=>U});module.exports=A(Q);var c=R(require("react"),1);var n={base:"var(--dsw-alias-bg-base)",l1:"var(--dsw-alias-bg-layer-1)",l2:"var(--dsw-alias-bg-layer-2)",overlay:"var(--dsw-alias-bg-overlay)",line:"var(--dsw-alias-border-l1)",line2:"var(--dsw-alias-border-l2)",fg:"var(--dsw-alias-label-primary)",fg2:"var(--dsw-alias-label-secondary)",fg3:"var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))",ok:"var(--dsw-alias-state-success-primary)",warn:"var(--dsw-alias-state-warn-primary)",err:"var(--dsw-alias-state-error-primary)",idle:"var(--dsw-alias-state-idle-primary)"},l=(e,t,i="transparent")=>`color-mix(in srgb, ${e} ${t}%, ${i})`;function z(e){return`
.${e}-page { height:100%; overflow:auto; color:${n.fg}; font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
.${e}-inner { max-width:940px; margin:0 auto; padding:44px 36px 96px; display:flex; flex-direction:column; gap:32px; }
.${e}-head { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-wrap:wrap; }
.${e}-head h1 { margin:0; font-size:28px; font-weight:650; letter-spacing:-.025em; line-height:1.15; }
.${e}-head p { margin:8px 0 0; max-width:540px; color:${n.fg2}; font-size:13.5px; line-height:1.6; }
.${e}-section { display:flex; flex-direction:column; gap:12px; }
.${e}-section-head { display:flex; align-items:baseline; gap:8px; }
.${e}-section-head h2 { margin:0; font-size:13px; font-weight:600; letter-spacing:-.005em; }
.${e}-count { font-size:12px; color:${n.fg3}; font-variant-numeric:tabular-nums; }
.${e}-aside { margin-left:auto; font-size:12px; color:${n.fg3}; }

.${e}-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:32px; padding:0 12px; border-radius:8px; border:none;
  box-shadow:inset 0 0 0 1px ${n.line2}; background:${n.l1}; color:${n.fg}; font:inherit; font-weight:500; cursor:pointer; white-space:nowrap;
  transition:background .12s, box-shadow .12s, color .12s, transform .06s; }
.${e}-btn:hover:not(:disabled) { background:${n.l2}; }
.${e}-btn:active:not(:disabled) { transform:translateY(.5px); }
.${e}-btn:disabled { opacity:.42; cursor:default; }
.${e}-btn.primary { background:${n.fg}; color:${n.base}; box-shadow:0 1px 2px rgba(0,0,0,.12); }
.${e}-btn.primary:hover:not(:disabled) { background:${l(n.fg,84,n.base)}; }
.${e}-btn.ghost { background:transparent; box-shadow:none; color:${n.fg2}; }
.${e}-btn.ghost:hover:not(:disabled) { background:${n.l2}; color:${n.fg}; }
.${e}-btn.danger { color:${n.err}; }
.${e}-btn.danger:hover:not(:disabled) { background:${l(n.err,10)}; color:${n.err}; }
.${e}-btn.danger-solid { background:${n.err}; color:#fff; box-shadow:none; }
.${e}-btn.danger-solid:hover:not(:disabled) { background:${l(n.err,88,"#000")}; }
.${e}-btn.sm { height:28px; padding:0 10px; font-size:12.5px; border-radius:7px; gap:5px; }
.${e}-btn.icon { width:28px; padding:0; }
.${e}-btn:focus-visible, .${e}-focus:focus-visible { outline:none; box-shadow:0 0 0 3px ${l(n.fg,16)}; }
.${e}-grow { flex:1; }

.${e}-switch { position:relative; width:30px; height:18px; flex:none; padding:0; border:none; border-radius:999px; background:${l(n.fg,16)}; cursor:pointer; transition:background .18s; }
.${e}-switch::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.28); transition:transform .2s cubic-bezier(.3,.7,.4,1.2); }
.${e}-switch.on { background:${n.ok}; }
.${e}-switch.on::after { transform:translateX(12px); }
.${e}-switch:disabled { opacity:.5; cursor:default; }
.${e}-switch:focus-visible { outline:none; box-shadow:0 0 0 3px ${l(n.fg,16)}; }

.${e}-status { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:${n.fg2}; white-space:nowrap; }
.${e}-dot { width:7px; height:7px; flex:none; border-radius:50%; background:${n.idle}; }
.${e}-dot.ok { background:${n.ok}; box-shadow:0 0 0 3px ${l(n.ok,18)}; }
.${e}-dot.warn { background:${n.warn}; box-shadow:0 0 0 3px ${l(n.warn,20)}; }
.${e}-dot.err { background:${n.err}; box-shadow:0 0 0 3px ${l(n.err,16)}; }
.${e}-dot.busy { background:${n.warn}; animation:${e}-pulse 1.1s ease-in-out infinite; }
.${e}-sep { width:3px; height:3px; flex:none; border-radius:50%; background:currentColor; opacity:.35; }

.${e}-note { display:flex; gap:9px; align-items:flex-start; padding:10px 12px; border-radius:10px; background:${n.l2}; color:${n.fg2}; font-size:12.5px; line-height:1.6; white-space:pre-wrap; word-break:break-word; }
.${e}-note > svg { flex:none; margin-top:2px; }
.${e}-note a { color:${n.fg}; font-weight:500; text-decoration:none; box-shadow:inset 0 -1px 0 ${l(n.fg,30)}; }
.${e}-note.err { background:${l(n.err,8)}; color:${n.err}; }
.${e}-note.warn { background:${l(n.warn,13)}; color:${n.fg}; }
.${e}-note.warn > svg { color:${n.warn}; }
a.${e}-note { text-decoration:none; cursor:pointer; transition:background .12s; }
a.${e}-note.warn:hover { background:${l(n.warn,20)}; }

.${e}-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
.${e}-field-label { display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12.5px; font-weight:500; color:${n.fg2}; }
.${e}-field-label a { display:inline-flex; align-items:center; gap:3px; font-weight:500; color:${n.fg}; text-decoration:none; }
.${e}-field-label a:hover { text-decoration:underline; }
.${e}-hint { font-size:12px; line-height:1.5; color:${n.fg3}; }
.${e}-input { height:34px; padding:0 11px; border:none; border-radius:8px; box-shadow:inset 0 0 0 1px ${n.line2}; background:${n.base}; color:inherit; font:inherit; min-width:0; transition:box-shadow .12s; }
.${e}-input::placeholder { color:${n.fg3}; opacity:.8; }
.${e}-input:hover { box-shadow:inset 0 0 0 1px ${l(n.fg,22)}; }
.${e}-input:focus { outline:none; box-shadow:inset 0 0 0 1px ${l(n.fg,45)}, 0 0 0 3px ${l(n.fg,9)}; }
textarea.${e}-input { height:auto; min-height:96px; padding:9px 11px; resize:vertical; line-height:1.6; }
select.${e}-input { padding-right:28px; appearance:none; background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%); background-position:calc(100% - 15px) 15px,calc(100% - 11px) 15px; background-size:4px 4px; background-repeat:no-repeat; }
.${e}-mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
.${e}-row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.${e}-row3 { display:grid; grid-template-columns:2fr 1fr; gap:12px; }

.${e}-seg { display:flex; gap:2px; padding:3px; border-radius:10px; background:${n.l2}; }
.${e}-seg button { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; height:28px; padding:0 10px; border:none; border-radius:7px; background:transparent; color:${n.fg2}; font:inherit; font-size:12.5px; font-weight:500; white-space:nowrap; cursor:pointer; transition:background .12s, color .12s; }
.${e}-seg button:hover { color:${n.fg}; }
.${e}-seg button.on { background:${n.overlay}; color:${n.fg}; box-shadow:0 1px 2px rgba(0,0,0,.07), 0 0 0 .5px ${n.line2}; }
.${e}-seg button:focus-visible { outline:none; box-shadow:0 0 0 2px ${l(n.fg,25)}; }

.${e}-details > summary { display:inline-flex; align-items:center; gap:5px; list-style:none; cursor:pointer; color:${n.fg2}; font-size:12.5px; font-weight:500; user-select:none; }
.${e}-details > summary::-webkit-details-marker { display:none; }
.${e}-details > summary:hover { color:${n.fg}; }
.${e}-details > summary svg { transition:transform .15s; }
.${e}-details[open] > summary svg { transform:rotate(90deg); }
.${e}-details-body { margin-top:12px; display:flex; flex-direction:column; gap:12px; }

.${e}-scrim { position:fixed; inset:0; z-index:1000; display:flex; align-items:flex-start; justify-content:center; padding:9vh 16px 4vh; overflow:auto; background:rgba(12,12,16,.34); backdrop-filter:blur(4px); animation:${e}-fade .14s ease-out; }
.${e}-modal { width:min(560px,100%); overflow:hidden; border-radius:16px; background:${n.overlay}; color:${n.fg}; font-size:13px; box-shadow:0 0 0 1px ${n.line}, 0 24px 70px -14px rgba(0,0,0,.35); animation:${e}-rise .2s cubic-bezier(.2,.8,.3,1); }
.${e}-modal-head { display:flex; align-items:center; gap:12px; padding:18px 18px 14px 20px; }
.${e}-modal-head h2 { margin:0; font-size:15px; font-weight:600; letter-spacing:-.01em; }
.${e}-modal-head p { margin:2px 0 0; font-size:12.5px; color:${n.fg2}; line-height:1.45; }
.${e}-modal-body { display:flex; flex-direction:column; gap:16px; padding:6px 20px 20px; }
.${e}-modal-foot { display:flex; align-items:center; justify-content:flex-end; gap:8px; padding:12px 16px 12px 20px; border-top:1px solid ${n.line}; background:${l(n.l2,55)}; }
.${e}-modal-foot .${e}-error { margin-right:auto; }
.${e}-error { color:${n.err}; font-size:12.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }

.ui-logo { display:inline-flex; flex:none; align-items:center; justify-content:center; background:#fff; color:#1f2328; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
.ui-logo.dark { background:#1f2328; color:#fff; box-shadow:none; }
.ui-logo.tint { background:${n.l2}; color:${n.fg2}; box-shadow:inset 0 0 0 1px ${n.line}; }
.ui-logo.notion { font-family:Georgia,'Times New Roman',serif; font-weight:700; color:#111; }

.${e}-spin { animation:${e}-spin .8s linear infinite; }
@keyframes ${e}-spin { to { transform:rotate(360deg); } }
@keyframes ${e}-pulse { 50% { opacity:.35; } }
@keyframes ${e}-fade { from { opacity:0; } }
@keyframes ${e}-rise { from { opacity:0; transform:translateY(8px) scale(.985); } }
@media (prefers-reduced-motion:reduce) { .${e}-scrim, .${e}-modal, .${e}-spin, .${e}-dot.busy { animation:none; } }
`}var v="var(--dsw-alias-label-primary)",u="var(--dsw-alias-label-secondary)",S="var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))",k="var(--dsw-alias-bg-layer-1)",C="var(--dsw-alias-bg-layer-2)",b="var(--dsw-alias-border-l1)",P=z("px")+`
.px-card { display:flex; gap:20px; align-items:center; padding:18px 20px; border-radius:14px; background:${k}; box-shadow:0 0 0 1px ${b}, 0 1px 2px rgba(0,0,0,.03); }
.px-list { border-radius:14px; background:${k}; box-shadow:0 0 0 1px ${b}, 0 1px 2px rgba(0,0,0,.03); overflow:hidden; }
.px-item { display:flex; align-items:center; gap:14px; padding:14px 18px; }
.px-item + .px-item { border-top:1px solid ${b}; }
.px-item-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.px-item-main b { font-size:14px; font-weight:600; letter-spacing:-.01em; }
.px-item-main span { font-size:12.5px; color:${u}; line-height:1.55; }
.px-row-actions { display:flex; gap:8px; flex:none; align-items:center; }
.px-muted { font-size:12px; color:${S}; }
.px-empty { display:flex; flex-direction:column; align-items:center; gap:6px; padding:40px 20px; border-radius:14px; background:${k}; box-shadow:0 0 0 1px ${b}; color:${u}; text-align:center; }
.px-empty b { color:${v}; font-size:14px; }
.px-empty-icon { display:grid; place-items:center; width:44px; height:44px; margin-bottom:4px; border-radius:12px; background:${C}; color:${u}; }
.px-offer { align-items:flex-start; }
.px-qr { flex:none; width:220px; height:220px; padding:10px; border-radius:12px; background:#fff; box-shadow:0 0 0 1px ${b}; }
.px-qr svg { width:100%; height:100%; display:block; }
.px-offer-text { display:flex; flex-direction:column; gap:10px; font-size:13px; color:${u}; }
.px-offer-text b { color:${v}; font-size:16px; font-weight:600; letter-spacing:-.01em; }
.px-offer-text ol { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px; line-height:1.6; }
.px-offer-text code { padding:1px 5px; border-radius:5px; background:${C}; font-size:12px; color:${v}; }
.px-confirm { flex-direction:column; align-items:stretch; }
.px-confirm-head { display:flex; gap:12px; align-items:flex-start; }
.px-confirm-head div { display:flex; flex-direction:column; gap:3px; }
.px-confirm-head b { font-size:15px; }
.px-confirm-head span { color:${u}; font-size:12.5px; }
.px-sas { font-size:44px; font-weight:650; letter-spacing:.12em; text-align:center; font-variant-numeric:tabular-nums; padding:8px 0; }
.px-sas i { display:inline-block; width:10px; }
.px-confirm .px-row-actions { justify-content:flex-end; }
.px-away { gap:24px; }
.px-foot { font-size:11.5px; color:${S}; }
`;var a=require("react/jsx-runtime"),G="@local/dsh-pair",$="local-pair",T="local-pair",U=["slots","locale"],_=e=>new URL("api/pair"+e,document.baseURI);async function w(e,t,i,o){let s={method:e,credentials:"same-origin",signal:o,headers:{}};i!==void 0&&(s.body=JSON.stringify(i),s.headers["Content-Type"]="application/json");let p=await fetch(_(t),s),r;try{r=await p.json()}catch{r=void 0}if(!p.ok)throw new Error(r?.error??`HTTP ${p.status}`);return r}function y({size:e=18}){return(0,a.jsxs)("svg",{width:e,height:e,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"1.8",strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true",children:[(0,a.jsx)("rect",{x:"6.5",y:"2.5",width:"11",height:"19",rx:"2.5"}),(0,a.jsx)("path",{d:"M10.5 18.5h3"})]})}function B(e){if(!e)return"\u2014";let t=Math.round((Date.now()-e)/1e3);return t<60?"\u521A\u521A":t<3600?`${Math.floor(t/60)} \u5206\u949F\u524D`:t<86400?`${Math.floor(t/3600)} \u5C0F\u65F6\u524D`:new Date(e).toLocaleDateString()}function H(){let[e,t]=c.default.useState(null),[i,o]=c.default.useState(null),s=c.default.useRef(-1),p=c.default.useCallback(async()=>{try{let r=await w("GET","/state");s.current=r.revision,t(r),o(null)}catch(r){o(r.message)}},[]);return c.default.useEffect(()=>{let r=!1,x=new AbortController;return(async()=>{for(await p();!r;)try{let{revision:g}=await w("GET",`/wait?revision=${s.current}`,void 0,x.signal);g!==s.current&&await p()}catch{if(r)break;await new Promise(g=>setTimeout(g,2e3))}})(),()=>{r=!0,x.abort()}},[p]),[e,i,t]}function Y({on:e,onChange:t,disabled:i}){return(0,a.jsx)("button",{type:"button",role:"switch","aria-checked":e,className:`px-switch${e?" on":""}`,disabled:i,onClick:()=>t(!e)})}function F({until:e}){let[,t]=c.default.useReducer(o=>o+1,0);c.default.useEffect(()=>{let o=setInterval(t,1e3);return()=>clearInterval(o)},[]);let i=Math.max(0,Math.round((e-Date.now())/1e3));return(0,a.jsxs)("span",{children:[Math.floor(i/60),":",String(i%60).padStart(2,"0")]})}function J({data:e,act:t,busy:i}){let{offer:o,request:s}=e.pairing,[p,r]=c.default.useState(!1);return s?(0,a.jsxs)("div",{className:"px-card px-confirm",children:[(0,a.jsxs)("div",{className:"px-confirm-head",children:[(0,a.jsx)(y,{size:22}),(0,a.jsxs)("div",{children:[(0,a.jsxs)("b",{children:["\u300C",s.name,"\u300D\u8BF7\u6C42\u914D\u5BF9"]}),(0,a.jsx)("span",{children:"\u786E\u8BA4\u624B\u673A\u4E0A\u663E\u793A\u7684\u6838\u5BF9\u7801\u4E0E\u4E0B\u9762\u4E00\u81F4\uFF0C\u518D\u70B9\u5141\u8BB8\u3002"})]})]}),(0,a.jsxs)("div",{className:"px-sas",children:[s.sas.slice(0,3),(0,a.jsx)("i",{})," ",s.sas.slice(3)]}),(0,a.jsxs)("div",{className:"px-row-actions",children:[(0,a.jsx)("button",{type:"button",className:"px-btn",disabled:i,onClick:()=>t("POST","/decide",{allow:!1}),children:"\u62D2\u7EDD"}),(0,a.jsx)("button",{type:"button",className:"px-btn primary",disabled:i,onClick:()=>t("POST","/decide",{allow:!0}),children:"\u5141\u8BB8\u8FDE\u63A5"})]})]}):o?(0,a.jsxs)("div",{className:"px-card px-offer",children:[(0,a.jsx)("div",{className:"px-qr",dangerouslySetInnerHTML:{__html:o.qr}}),(0,a.jsxs)("div",{className:"px-offer-text",children:[(0,a.jsx)("b",{children:"\u7528 iPhone \u76F8\u673A\u626B\u63CF\u4E8C\u7EF4\u7801"}),(0,a.jsxs)("ol",{children:[(0,a.jsxs)("li",{children:["\u7B2C\u4E00\u6B21\u4F7F\u7528\uFF1A\u5148\u7528 Safari \u6253\u5F00 ",(0,a.jsx)("code",{children:new URL(e.relay.url).host}),"\uFF0C\u70B9\u300C\u5206\u4EAB \u2192 \u6DFB\u52A0\u5230\u4E3B\u5C4F\u5E55\u300D\uFF0C\u518D\u4ECE\u4E3B\u5C4F\u5E55 App \u91CC\u626B\u7801\uFF0C\u8FD9\u6837\u624D\u80FD\u6536\u5230\u901A\u77E5\u3002"]}),(0,a.jsx)("li",{children:"\u626B\u7801\u540E\u624B\u673A\u4F1A\u663E\u793A 6 \u4F4D\u6838\u5BF9\u7801\uFF0C\u8FD9\u91CC\u4F1A\u5F39\u51FA\u786E\u8BA4\u3002"})]}),(0,a.jsxs)("div",{className:"px-muted",children:["\u4E8C\u7EF4\u7801\u53EA\u80FD\u7528\u4E00\u6B21\uFF0C",(0,a.jsx)(F,{until:o.expiresAt})," \u540E\u5931\u6548\u3002"]}),(0,a.jsxs)("div",{className:"px-row-actions",children:[(0,a.jsx)("button",{type:"button",className:"px-btn sm",onClick:async()=>{await navigator.clipboard.writeText(o.link),r(!0),setTimeout(()=>r(!1),1500)},children:p?"\u5DF2\u590D\u5236":"\u590D\u5236\u914D\u5BF9\u94FE\u63A5"}),(0,a.jsx)("button",{type:"button",className:"px-btn sm ghost",disabled:i,onClick:()=>t("POST","/cancel"),children:"\u53D6\u6D88"})]})]})]}):null}function K({items:e,act:t,busy:i}){return e.length?(0,a.jsxs)("section",{className:"px-section",children:[(0,a.jsxs)("div",{className:"px-section-head",children:[(0,a.jsx)("h2",{children:"\u7B49\u5F85\u5904\u7406"}),(0,a.jsx)("span",{className:"px-count",children:e.length})]}),(0,a.jsx)("div",{className:"px-list",children:e.map(o=>(0,a.jsxs)("div",{className:"px-item",children:[(0,a.jsxs)("div",{className:"px-item-main",children:[(0,a.jsx)("b",{children:o.kind==="approval"?`\u5BA1\u6279\uFF1A${o.toolName}`:"\u63D0\u95EE"}),(0,a.jsxs)("span",{children:[o.sessionTitle??o.sessionId,o.reason?` \xB7 ${o.reason}`:"",o.kind==="question"?` \xB7 ${o.questions?.[0]?.question??""}`:""]})]}),o.kind==="approval"?(0,a.jsxs)("div",{className:"px-row-actions",children:[(0,a.jsx)("button",{type:"button",className:"px-btn sm danger",disabled:i,onClick:()=>t("POST","/answer",{id:o.id,decision:"reject"}),children:"\u62D2\u7EDD"}),(0,a.jsx)("button",{type:"button",className:"px-btn sm primary",disabled:i,onClick:()=>t("POST","/answer",{id:o.id,decision:"allow"}),children:"\u5141\u8BB8\u4E00\u6B21"})]}):(0,a.jsx)("span",{className:"px-muted",children:"\u8BF7\u5728\u624B\u673A\u4E0A\u56DE\u7B54"})]},o.id))})]}):null}function W(){let[e,t,i]=H(),[o,s]=c.default.useState(!1),[p,r]=c.default.useState(null),x=async(d,f,j)=>{s(!0),r(null);try{i(await w(d,f,j))}catch(q){r(q.message)}finally{s(!1)}},g=async d=>{r(null);try{let f=await w("POST","/test-push",{deviceId:d});f.sent||r(f.reason==="no-subscription"?"\u8FD9\u53F0\u624B\u673A\u8FD8\u6CA1\u6709\u5F00\u542F\u901A\u77E5\uFF08\u5728\u624B\u673A App \u7684\u8BBE\u7F6E\u91CC\u6253\u5F00\uFF09":`\u63A8\u9001\u5931\u8D25\uFF1A${f.reason}`)}catch(f){r(f.message)}},m=e?.relay.status;return(0,a.jsx)("div",{className:"px-page",children:(0,a.jsxs)("div",{className:"px-inner",children:[(0,a.jsxs)("header",{className:"px-head",children:[(0,a.jsxs)("div",{children:[(0,a.jsx)("h1",{children:"\u624B\u673A"}),(0,a.jsx)("p",{children:"\u5728\u624B\u673A\u4E0A\u67E5\u770B\u4F1A\u8BDD\u3001\u53D1\u6D88\u606F\u3001\u505C\u6B62\u4EFB\u52A1\u3001\u5BA1\u6279\u64CD\u4F5C\uFF0C\u5E76\u5728\u5B8C\u6210\u6216\u9700\u8981\u4F60\u65F6\u6536\u5230\u901A\u77E5\u3002\u901A\u4FE1\u7ECF Cloudflare \u4E2D\u7EE7\u8F6C\u53D1\uFF0C\u5168\u7A0B\u7AEF\u5230\u7AEF\u52A0\u5BC6\uFF0C\u4E2D\u7EE7\u770B\u4E0D\u5230\u5185\u5BB9\u3002"})]}),e?(0,a.jsxs)("span",{className:"px-status",children:[(0,a.jsx)("span",{className:`px-dot ${m==="online"?"ok":m==="connecting"?"busy":"err"}`}),m==="online"?"\u4E2D\u7EE7\u5DF2\u8FDE\u63A5":m==="connecting"?"\u6B63\u5728\u8FDE\u63A5\u4E2D\u7EE7\u2026":"\u4E2D\u7EE7\u672A\u8FDE\u63A5"]}):null]}),t?(0,a.jsx)("div",{className:"px-note err",children:t}):null,p?(0,a.jsx)("div",{className:"px-note err",children:p}):null,e?(0,a.jsxs)(a.Fragment,{children:[e.pairing.offer||e.pairing.request?(0,a.jsx)(J,{data:e,act:x,busy:o}):null,(0,a.jsx)(K,{items:e.pending,act:x,busy:o}),(0,a.jsxs)("section",{className:"px-section",children:[(0,a.jsxs)("div",{className:"px-section-head",children:[(0,a.jsx)("h2",{children:"\u5DF2\u914D\u5BF9\u7684\u624B\u673A"}),(0,a.jsx)("span",{className:"px-count",children:e.devices.length}),(0,a.jsx)("span",{className:"px-grow"}),!e.pairing.offer&&!e.pairing.request?(0,a.jsxs)("button",{type:"button",className:"px-btn primary",disabled:o,onClick:()=>x("POST","/start"),children:[(0,a.jsx)(y,{size:15}),"\u914D\u5BF9\u65B0\u624B\u673A"]}):null]}),e.devices.length===0?(0,a.jsxs)("div",{className:"px-empty",children:[(0,a.jsx)("span",{className:"px-empty-icon",children:(0,a.jsx)(y,{size:22})}),(0,a.jsx)("b",{children:"\u8FD8\u6CA1\u6709\u914D\u5BF9\u7684\u624B\u673A"}),(0,a.jsx)("span",{children:"\u70B9\u300C\u914D\u5BF9\u65B0\u624B\u673A\u300D\uFF0C\u7528\u624B\u673A\u626B\u7801\u5373\u53EF\u3002"})]}):(0,a.jsx)("div",{className:"px-list",children:e.devices.map(d=>(0,a.jsxs)("div",{className:"px-item",children:[(0,a.jsx)("span",{className:`px-dot ${d.online?"ok":""}`}),(0,a.jsxs)("div",{className:"px-item-main",children:[(0,a.jsx)("b",{children:d.name}),(0,a.jsxs)("span",{children:[d.online?"\u5728\u7EBF":`\u4E0A\u6B21\u5728\u7EBF ${B(d.lastSeen)}`," \xB7 ",d.push?"\u901A\u77E5\u5DF2\u5F00\u542F":"\u901A\u77E5\u672A\u5F00\u542F"," \xB7 \u914D\u5BF9\u4E8E ",new Date(d.createdAt).toLocaleDateString()]})]}),(0,a.jsxs)("div",{className:"px-row-actions",children:[d.push?(0,a.jsx)("button",{type:"button",className:"px-btn sm ghost",onClick:()=>g(d.id),children:"\u6D4B\u8BD5\u901A\u77E5"}):null,(0,a.jsx)("button",{type:"button",className:"px-btn sm danger",disabled:o,onClick:()=>{confirm(`\u79FB\u9664\u300C${d.name}\u300D\uFF1F\u5B83\u5C06\u65E0\u6CD5\u518D\u8FDE\u63A5\u8FD9\u53F0\u7535\u8111\u3002`)&&x("POST","/revoke",{deviceId:d.id})},children:"\u79FB\u9664"})]})]},d.id))})]}),(0,a.jsxs)("section",{className:"px-section",children:[(0,a.jsx)("div",{className:"px-section-head",children:(0,a.jsx)("h2",{children:"\u79BB\u5F00\u6A21\u5F0F"})}),(0,a.jsxs)("div",{className:"px-card px-away",children:[(0,a.jsxs)("div",{className:"px-item-main",children:[(0,a.jsx)("b",{children:e.away.on?"\u79BB\u5F00\u4E2D\uFF1A\u5BA1\u6279\u548C\u63D0\u95EE\u4F1A\u53D1\u5230\u624B\u673A":"\u5728\u7535\u8111\u524D"}),(0,a.jsxs)("span",{children:["\u5F00\u542F\u540E\uFF0C\u6B63\u5728\u8FD0\u884C\u7684\u4F1A\u8BDD\u4F1A\u4E34\u65F6\u5207\u6362\u5230\u300C",e.away.preset,"\u300D\u6743\u9650\uFF08\u5199\u5DE5\u4F5C\u533A\u5916\u7684\u6587\u4EF6\u6216\u6267\u884C\u9AD8\u98CE\u9669\u547D\u4EE4\u524D\u9700\u8981\u5BA1\u6279\uFF09\uFF0C\u5BA1\u6279\u548C\u63D0\u95EE\u6539\u7531\u624B\u673A\u5904\u7406\uFF0C",e.away.on?`\u5DF2\u5207\u6362 ${e.away.sessions} \u4E2A\u4F1A\u8BDD\u3002`:"\u5173\u95ED\u540E\u6062\u590D\u539F\u6765\u7684\u6743\u9650\u3002","\u672A\u5904\u7406\u7684\u5BA1\u6279 30 \u5206\u949F\u540E\u81EA\u52A8\u62D2\u7EDD\u3002"]})]}),(0,a.jsx)(Y,{on:e.away.on,disabled:o||e.devices.length===0,onChange:d=>x("POST","/away",{on:d})})]})]}),(0,a.jsxs)("div",{className:"px-foot",children:["\u4E2D\u7EE7\uFF1A",e.relay.url," \xB7 \u8BBE\u5907 ID ",e.desktopId]})]}):(0,a.jsx)("div",{className:"px-empty",children:"\u52A0\u8F7D\u4E2D\u2026"})]})})}function X(e){e.effect(()=>e.locale.register($,{zh:{panel:"\u624B\u673A"},en:{panel:"Phone"}}),"dsh-pair: dictionary");let t=e.locale.bind($);e.effect(()=>{let i=document.createElement("style");return i.dataset.plugin=G,i.textContent=P,document.head.appendChild(i),()=>i.remove()},"dsh-pair: styles"),e.effect(()=>e.slots.inject("main",()=>e.slots.register({name:"main",key:T,locale:$},W)),"dsh-pair: page"),e.effect(()=>e.slots.inject("sidebar.panellist",()=>e.slots.register({name:"sidebar.panellist",id:T,order:15,locale:$,label:()=>t("panel")},y)),"dsh-pair: sidebar entry")}

    return module.exports;
  },
});
