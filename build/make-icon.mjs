// Renders the app icon from the brand mark: the hero's split bar, the thin side bright, on the near-black surface.
import { chromium } from '@playwright/test';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024"><rect width="64" height="64" rx="15" fill="#09090b"/><rect x="12" y="29" width="13" height="6" rx="3" fill="#f4f4f5"/><rect x="28" y="29" width="24" height="6" rx="3" fill="#52525b"/></svg>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await p.screenshot({ path: process.argv[2] ?? 'build/icon.png', omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await b.close();
console.log('icon written');
