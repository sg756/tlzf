const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public');
const dest = path.join(__dirname, '..', 'dist', 'public');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('缺少 public/index.html');
  process.exit(1);
}
fs.cpSync(src, dest, { recursive: true });

const vendorSrc = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
const vendorDest = path.join(__dirname, '..', 'dist', 'vendor');
const wasmJs = path.join(vendorSrc, 'sql-wasm.js');
const wasmBin = path.join(vendorSrc, 'sql-wasm.wasm');
if (!fs.existsSync(wasmJs) || !fs.existsSync(wasmBin)) {
  console.error('缺少 node_modules/sql.js/dist，请先 npm install');
  process.exit(1);
}
fs.mkdirSync(vendorDest, { recursive: true });
fs.copyFileSync(wasmJs, path.join(vendorDest, 'sql-wasm.js'));
fs.copyFileSync(wasmBin, path.join(vendorDest, 'sql-wasm.wasm'));

const distDir = path.join(__dirname, '..', 'dist');
for (const name of ['package.json', 'package-lock.json']) {
  const extra = path.join(distDir, name);
  if (fs.existsSync(extra)) fs.unlinkSync(extra);
}
