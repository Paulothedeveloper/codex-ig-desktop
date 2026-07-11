import { createRequire } from "module";
const require = createRequire("C:/Users/paulo/.claude/skills/playwright-skill/node_modules/");
const { chromium } = require("playwright");
const INST = "D:/Projetos do Claude/Codex-IG-Desktop/app/src-tauri/installer/";
const ORBIT = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 1024 1024"><defs><linearGradient id="t" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0aa892"/><stop offset="1" stop-color="#00e5c9"/></linearGradient><radialGradient id="g" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff4d3d" stop-opacity=".5"/><stop offset="1" stop-color="#ff4d3d" stop-opacity="0"/></radialGradient></defs><path d="M 296 726 A 348 306 -12 0 1 694 366" fill="none" stroke="url(#t)" stroke-width="84" stroke-linecap="round"/><circle cx="704" cy="344" r="158" fill="url(#g)"/><circle cx="704" cy="344" r="76" fill="#ff4d3d"/></svg>`;
const F = `font-family:'Segoe UI',Arial,sans-serif`;
const header = `<body style="margin:0;width:150px;height:57px;background:#0b0e17;display:flex;align-items:center;gap:8px;padding:0 10px;box-sizing:border-box;${F}">${ORBIT(38)}<div><div style="color:#00e5c9;font-weight:800;font-size:15px;line-height:1">Codex IG</div><div style="color:#8892a0;font-size:7px;letter-spacing:1.5px">GROWTH SUITE</div></div></body>`;
const sidebar = `<body style="margin:0;width:164px;height:314px;background:linear-gradient(160deg,#0e1420,#090d14);display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:26px 14px;box-sizing:border-box;${F}"><div style="display:flex;flex-direction:column;align-items:center;gap:12px">${ORBIT(76)}<div style="text-align:center"><div style="color:#00e5c9;font-weight:800;font-size:20px;line-height:1">Codex IG</div><div style="color:#8892a0;font-size:8px;letter-spacing:2px;margin-top:3px">GROWTH SUITE</div></div></div><div style="color:#8892a0;font-size:9px;text-align:center;line-height:1.5">Crescimento do teu<br>Instagram, local e<br>na tua sessão.</div></body>`;
const run = async () => {
  const b = await chromium.launch();
  for (const [html, name, w, h] of [[header,"header",150,57],[sidebar,"sidebar",164,314]]) {
    const p = await (await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:1 })).newPage();
    await p.setContent(html);
    await p.screenshot({ path: INST+name+".png", clip:{x:0,y:0,width:w,height:h} });
    await p.close();
  }
  await b.close(); console.log("PNG gerados");
};
run().catch(e=>{console.error(String(e).slice(0,150));process.exit(1)});
