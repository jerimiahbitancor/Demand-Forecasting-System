// frontend/src/utils/ingredientPurchase.js
//
// The wording and the small rules behind the "how much do you buy" fields of
// the ingredient form. The Add window and the Edit window both use these
// helpers, so the two can never drift apart.
//
// One ingredient has two different amounts, and they are easy to mix up:
//
//   - the PURCHASE PACK: what one delivery holds ("1 kg of pork for ₱300").
//     This is what the pack fields hold and what the cost per unit is
//     worked out from.
//   - the RECIPE PORTION: how much one serving of a dish uses ("250 g").
//     This lives in the Menu Builder (product_ingredients) and is what the
//     stock is deducted by.
//
// The form never asks for the recipe portion. It says where the portions
// already are, so nobody types a portion into the pack field.

import { unitKindOf, unitShortLabel, parseRecipeQuantity } from './recipeUnits.js';
import { formatStockQty, isCountUnit } from './formatStockQty.js';

// Categories whose items are never measured with cups or spoons. A cup of
// pork is not a thing, and the field only confuses the owner there.
export const CUP_FIELD_HIDDEN_CATEGORIES = Object.freeze([
	'Meat & Poultry',
	'Seafood',
	'Vegetables & Fruits',
	'Packaging & Supplies',
]);

// 'mass' | 'volume' | 'count' | null (unknown).
export const unitFamily = (unit) => {
	const text = String(unit || '').trim();
	if (!text) return null;
	if (isCountUnit(text)) return 'count';
	const kind = unitKindOf(text);
	if (kind === 'mass' || kind === 'volume') return kind;
	if (kind === 'count' || kind === 'piece') return 'count';
	return null;
};

// The "One cup weighs (grams)" field is only worth showing when the item can
// actually be measured with cups: a weight unit, and not a fresh meat or
// vegetable. A pack bought by weight but stocked in liters needs it too, so
// the pack can be turned into the stock unit.
export const shouldShowCupField = ({ category, stockUnit, packUnit }) => {
	const stock = unitFamily(stockUnit);
	const pack = unitFamily(packUnit);
	if (stock === 'count') return false;
	if (stock === 'volume') return pack === 'mass';
	if (stock === 'mass') {
		const name = String(category || '').trim();
		return !CUP_FIELD_HIDDEN_CATEGORIES.includes(name);
	}
	// Unknown unit: show the field. Hiding a value that is needed is worse
	// than showing one that is not.
	return true;
};

// "pcs" reads better as "pc" when it is the unit something is counted in.
const COUNT_UNIT_NOUNS = { pcs: 'pc', pc: 'pc', piece: 'piece', pieces: 'piece' };

// The word used for one unit: "per kg", "per pc", "per g".
export const perUnitNoun = (unit) => {
	const short = unitShortLabel(unit);
	return COUNT_UNIT_NOUNS[short.toLowerCase()] || short;
};

// ₱1,234.50
export const formatPeso = (value) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return '₱0.00';
	return `₱${n.toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
};

// The big unit a small unit is counted in, so the owner also sees the price
// they really pay per kilo or per litre: "₱2.50 per g (₱2,500.00 per kg)".
const BIG_UNIT_OF = { g: ['kg', 1000], ml: ['L', 1000] };

// The plain-English summary of the purchase pack:
//   "1 purchase pack = 1 kg, and it costs ₱300.00 → ₱300.00 per kg."
//   "1 purchase pack = 50 g, and it costs ₱125.00 → ₱2.50 per g (₱2,500.00 per kg)."
// Returns { headline, note } or null when the pack is not filled in yet.
export const purchasePackSummary = ({
	packQty,
	packUnit,
	packPrice,
	stockUnit,
	derivedUnitCost,
}) => {
	const qty = Number(parseRecipeQuantity(packQty));
	const price = Number(parseRecipeQuantity(packPrice));
	const packUnitName = String(packUnit || '').trim();
	if (!(qty > 0) || !(price > 0) || !packUnitName) return null;

	const packShort = unitShortLabel(packUnitName);
	const stockShort = unitShortLabel(stockUnit);
	const qtyText = formatStockQty(qty, packUnitName);

	let headline = `1 purchase pack = ${qtyText} ${packShort}, and it costs ${formatPeso(price)}`;

	// The pack unit cannot be turned into the stock unit, so the cost per unit
	// has to be typed by the owner.
	if (derivedUnitCost == null || !Number.isFinite(Number(derivedUnitCost))) {
		return {
			headline: `${headline}.`,
			note:
				'The purchase pack and the stock unit cannot be compared, so the cost per unit is not worked out from this. Type the cost per unit yourself.',
		};
	}

	const cost = Number(derivedUnitCost);
	headline += ` → ${formatPeso(cost)} per ${perUnitNoun(stockUnit)}`;

	const big = BIG_UNIT_OF[stockShort.toLowerCase()];
	if (big) {
		headline += ` (${formatPeso(cost * big[1])} per ${big[0]})`;
	}
	headline += '.';

	// The pack is counted in another measure than the stock (250 g bought,
	// stock counted in kg). Say so, so the cost per kg is never a surprise.
	const packFamily = unitFamily(packUnitName);
	const stockFamily = unitFamily(stockUnit);
	let note = '';
	if (
		packFamily &&
		stockFamily &&
		packFamily === stockFamily &&
		packShort.toLowerCase() !== stockShort.toLowerCase()
	) {
		note =
			`This pack holds ${qtyText} ${packShort}, but your stock is counted in ${stockShort}, `
			+ `so the cost per ${stockShort} (${formatPeso(cost)}) is worked out from the ${qtyText} ${packShort} pack. `
			+ `If you buy it by the ${stockShort}, set the pack to 1 ${stockShort} instead.`;
	}

	return { headline, note };
};

// The help under the purchase pack size field: what the number means and
// where the recipe portion actually goes.
export const packSizeHelp = (stockUnit) => {
	const family = unitFamily(stockUnit);
	const stockName = String(stockUnit || '').trim();
	const tail =
		'This is NOT the recipe portion — the portion is set in the Menu Builder, on the dish that uses this item.';
	if (family === 'count') {
		return `What you buy at once: type 30 for a 30-piece pack, or 1 for a single pack. ${tail}`;
	}
	if (family === 'volume') {
		return `What you buy at once: type 1 and keep ${stockName} if you buy it by the litre, or 1000 for a 1 L bottle. ${tail}`;
	}
	if (family === 'mass') {
		return `What you buy at once: type 1 and keep ${stockName} if you buy it by the kilo, or 500 for a 500 g tray. ${tail}`;
	}
	return `What you buy at once: type 1 and keep ${stockName || 'the stock unit'}, or 500 for a 500 g tray. ${tail}`;
};

// The help under the purchase pack unit field.
export const packUnitHelp =
	'How the purchase pack is counted, e.g. Grams (g) for a 500 g tray. Leave it on "Same as stock unit" unless you buy it in another measure.';

// The help under the purchase pack price field.
export const packPriceHelp =
	'What you pay for one purchase pack. The cost per unit is worked out from this and the pack size, so you do not have to type it.';

// The note shown where the "One cup weighs" field would be, when the item is
// not measured with cups at all.
export const cupFieldNotNeededNote =
	'Not needed — this item is not measured with cups. It is only used when a recipe measures the item in cups or spoons.';

// Which pack should be recorded? The same item can be set up two ways, and
// the cost per gram is the same either way — only the number you type in the
// recipes changes.
//
//   Scenario A: you buy the whole pack.
//   Scenario B: you sell or use the small packs.
//
// The example is one real case: a 165.6 g pack for ₱63 holds 6 small packs of
// 27.6 g, and 6 x ₱10.50 = ₱63, so the cost per gram stays ₱0.38/g.
export const packScenarioGuide = Object.freeze([
	Object.freeze({
		title: 'You buy the whole pack',
		detail: 'Record what one delivery holds: 165.6 g for ₱63 (₱0.38/g).',
	}),
	Object.freeze({
		title: 'You sell or use the small packs',
		detail:
			'Record the small pack: 27.6 g for ₱10.50 (₱63 ÷ 6 packs). Same ₱0.38/g — '
			+ 'and your recipes can then say "1 pack" instead of "27.6 g".',
	}),
]);

