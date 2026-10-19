import { cpSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../',import.meta.url);
const target = new URL('public/vendor/pdfjs/',root);
mkdirSync(target,{recursive:true});
for (const name of ['pdf.mjs','pdf.worker.mjs']) copyFileSync(new URL(`node_modules/pdfjs-dist/build/${name}`,root),new URL(name,target));
for (const name of ['cmaps','standard_fonts','wasm','iccs']) cpSync(fileURLToPath(new URL(`node_modules/pdfjs-dist/${name}`,root)),fileURLToPath(new URL(`${name}/`,target)),{recursive:true});
copyFileSync(new URL('node_modules/pdfjs-dist/LICENSE',root),new URL('LICENSE',target));
