/**
 * dist/ から Artifact 用の HTML を生成する。
 *
 * Artifact は publish 時にページを <!doctype html><head>…</head><body> で
 * ラップするため、Vite が出力する index.html をそのまま渡せない。
 * body の中身と、ハッシュ付きのアセット参照だけを抜き出して組み直す。
 *
 *   npm run build && node tools/make-artifact.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const src = readFileSync('dist/index.html', 'utf8');
const pick = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`dist/index.html に ${label} が見つかりません`);
  return m[1];
};

const body = pick(/<body>([\s\S]*)<\/body>/, 'body');
const js = pick(/<script type="module" crossorigin src="\.\/([^"]+)"/, 'entry script');
const css = pick(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)"/, 'stylesheet');
const preload = src.match(/<link rel="modulepreload" crossorigin href="\.\/([^"]+)"/);

const out = [
  '<title>ストラタコア</title>',
  '<meta name="theme-color" content="#f1e9d6">',
  `<link rel="stylesheet" href="${css}">`,
  preload ? `<link rel="modulepreload" href="${preload[1]}">` : null,
  body.trim(),
  `<script type="module" src="${js}"></script>`,
].filter(Boolean).join('\n');

mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/strata-core.html', out + '\n');

console.log('dist-artifact/strata-core.html を生成しました');

// publish するファイルは dist/ を走査して出す。フォントやスプライトを
// 足したときに、ここの一覧だけ古いまま公開してしまう事故を避ける
const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(full, base);
    return e.name === 'index.html' && dir === base ? [] : [full.slice(base.length + 1)];
  });

const files = walk('dist').sort();
console.log('publish するファイル:');
for (const f of files) console.log(`  ${f}`);
console.log('\nArtifact の files 引数:');
console.log(JSON.stringify(Object.fromEntries(files.map((f) => [f, f])), null, 1));
