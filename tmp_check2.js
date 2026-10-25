const fs = require('fs');
const test = fs.readFileSync('D:/Sales-Forecasting-System/backend/tests/inventoryRestock.test.js','utf8');
const ctrl = fs.readFileSync('D:/Sales-Forecasting-System/backend/controllers/inventoryController.js','utf8');
const i = test.indexOf('creating stock rejects unsupported material types'); if(i>=0){console.log(test.substring(i,i+250));}
const j = ctrl.indexOf('material_type'); if(j>=0){console.log('\n---\n'); console.log(ctrl.substring(Math.max(0,j-60), j+150));}
