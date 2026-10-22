const { Decimal } = require('decimal.js');
console.log('sum:', new Decimal('0.1').plus('0.2').toString());
console.log('equal:', new Decimal('0.1').plus('0.2').equals('0.3'));
