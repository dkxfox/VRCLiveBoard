// 主题系统(原 index.html 内联块, 2026-09-11 迁出 —— 见 M-20260911-16)
// 口径: 内部标识 = ASCII key(blue/teal/violet/green/amber/neon); 显示名经 window.t(themeXxx) 取词。
// 持久化: localStorage['vrcbTheme'](本机界面偏好, 与动效开关同一层, 不进 config);
//         启动优先级 = URL ?t=xxx > localStorage > 默认 blue。
const THEMES=[
 {name:'blue',c:{'--bg':'#10141a','--card':'#1a212b','--inset':'#141b24','--deep':'#0c0f14','--border':'#2a3442','--border2':'#232c38','--text':'#e8edf3','--muted':'#8b98a8','--faint':'#6b7888','--mono':'#9fb3c8','--accent':'#3b82f6','--accent2':'#2f6fd0','--gray':'#55606e','--gray2':'#48525e','--ok':'#3ddc84','--warn':'#f0b429','--err':'#e5484d'}},
 {name:'teal',c:{'--bg':'#0d1416','--card':'#14201f','--inset':'#101a19','--deep':'#0a1010','--border':'#23403d','--border2':'#1d3431','--text':'#e6f2f0','--muted':'#8fb0ab','--faint':'#6a8a85','--mono':'#9fd0c8','--accent':'#2dd4bf','--accent2':'#14b8a6','--gray':'#3f5c58','--gray2':'#37514e','--ok':'#34d399','--warn':'#fbbf24','--err':'#f87171'}},
 {name:'violet',c:{'--bg':'#12101a','--card':'#1c1830','--inset':'#161228','--deep':'#0d0a16','--border':'#3a2f5c','--border2':'#302944','--text':'#ede9ff','--muted':'#a49bc9','--faint':'#7e76a5','--mono':'#c4b8f0','--accent':'#8b5cf6','--accent2':'#7c4ce0','--gray':'#4a4468','--gray2':'#3f3a5a','--ok':'#34d399','--warn':'#fbbf24','--err':'#fb7185'}},
 {name:'green',c:{'--bg':'#0e1211','--card':'#16211c','--inset':'#111a16','--deep':'#0a0f0d','--border':'#274239','--border2':'#1f352d','--text':'#e7f3ec','--muted':'#93b3a4','--faint':'#6f9182','--mono':'#a3d3bd','--accent':'#34d399','--accent2':'#10b981','--gray':'#3c5a4e','--gray2':'#345048','--ok':'#4ade80','--warn':'#fbbf24','--err':'#f87171'}},
 {name:'amber',c:{'--bg':'#14110b','--card':'#201a12','--inset':'#191510','--deep':'#0e0b07','--border':'#4a3d26','--border2':'#3d3220','--text':'#f5eeda','--muted':'#b8a98c','--faint':'#8f8168','--mono':'#d8c79a','--accent':'#f59e0b','--accent2':'#d97706','--gray':'#5c4f33','--gray2':'#4f452e','--ok':'#4ade80','--warn':'#fbbf24','--err':'#f87171'}},
 {name:'neon',c:{'--bg':'#0c0e1a','--card':'#141735','--inset':'#0f1228','--deep':'#080a16','--border':'#2c3568','--border2':'#242c56','--text':'#eef0ff','--muted':'#9aa3d6','--faint':'#727aa6','--mono':'#b9c2ff','--accent':'#6366f1','--accent2':'#4f46e5','--gray':'#3d4270','--gray2':'#343a63','--ok':'#4ade80','--warn':'#fde047','--err':'#fb7185'}},
];
const sw=document.getElementById('swatches');const THEME_LABELS={'blue':'themeOcean','teal':'themeTeal','violet':'themeViolet','green':'themeGreen','amber':'themeAmber','neon':'themeNeon'};function themeLabel(n){return (window.t&&THEME_LABELS[n])?window.t(THEME_LABELS[n]):n;}window.__reThemeLabels=function(){var tn=document.getElementById('themeName');if(tn&&window.__curTheme)tn.textContent=themeLabel(window.__curTheme);THEMES.forEach(function(tm,i){var s=document.querySelectorAll('.swatch')[i];if(s)s.title=themeLabel(tm.name);});};
function setTheme(n,save){const th=THEMES.find(x=>x.name===n);if(!th)return;const r=document.documentElement;for(const k in th.c){r.style.setProperty(k,th.c[k]);}if(save!==false){try{localStorage.setItem('vrcbTheme',n);}catch(e){}}document.getElementById('themeName').textContent=themeLabel(n);window.__curTheme=n;document.querySelectorAll('.swatch').forEach((s,i)=>s.style.boxShadow='0 0 0 2px '+(THEMES[i].name===n?'var(--accent)':'transparent'));}
THEMES.forEach((th,i)=>{const d=document.createElement('span');d.className='swatch';d.title=themeLabel(th.name);d.style.cssText='cursor:pointer;width:22px;height:22px;border-radius:6px;background:'+th.c['--accent']+';border:1px solid var(--border);box-shadow:0 0 0 2px transparent';d.onclick=()=>setTheme(th.name);sw.appendChild(d);});
// 内部标识已统一为 ASCII key(blue/teal/...): 配置与 URL 参数直接用它, 不再需要中英映射层
// 启动时选主题(M-20260911-19): URL 参数(?t=xxx, 便于分享与测试) > 上次保存(localStorage) > 默认 blue
function pickTheme(){
  try{var q=new URLSearchParams(location.search).get('t');if(q&&THEMES.some(function(x){return x.name===q;}))return q;}catch(e){}
  try{var v=localStorage.getItem('vrcbTheme');if(v&&THEMES.some(function(x){return x.name===v;}))return v;}catch(e){}
  return 'blue';
}
setTheme(pickTheme(), false); // 首次应用不写盘: 只有用户显式点选才记录
