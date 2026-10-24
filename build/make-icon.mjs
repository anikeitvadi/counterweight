import { chromium } from '@playwright/test';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024"><rect width="64" height="64" rx="14" fill="#0d0d0d"/><rect x="12" y="34" width="8" height="18" rx="2" fill="#089981"/><rect x="24" y="22" width="8" height="30" rx="2" fill="#089981"/><rect x="36" y="28" width="8" height="24" rx="2" fill="#f23645"/><rect x="48" y="14" width="8" height="38" rx="2" fill="#f23645"/></svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await p.screenshot({ path: process.argv[2], omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await b.close();
console.log('icon written');
