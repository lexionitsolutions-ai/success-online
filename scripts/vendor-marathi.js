import { mkdirSync, copyFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
mkdirSync(new URL('public/vendor/', root), { recursive: true });
copyFileSync(new URL('node_modules/@indic-transliteration/sanscript/sanscript.js', root), new URL('public/vendor/sanscript.js', root));
copyFileSync(new URL('node_modules/@indic-transliteration/sanscript/LICENSE', root), new URL('public/vendor/sanscript-LICENSE', root));
