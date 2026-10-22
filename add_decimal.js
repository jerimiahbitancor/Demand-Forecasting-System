const fs = require('fs');
const p = 'D:/Sales-Forecasting-System/backend/package.json';
const d = JSON.parse(fs.readFileSync(p));
d.dependencies = d.dependencies || {};
if (!d.dependencies['decimal.js']) {
  d.dependencies['decimal.js'] = '^10.4.3';
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('done');
} else {
  console.log('exists');
}
