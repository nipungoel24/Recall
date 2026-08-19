const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
const out = process.argv[3];

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const manifest = {};
for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f));
  manifest[f] = crypto.createHash('sha384').update(content).digest('hex');
}
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', out, 'with', Object.keys(manifest).length, 'entries');
