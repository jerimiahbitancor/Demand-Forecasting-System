import { useEffect, useState } from "react";
import { FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "../InventoryModal";
import InfoTip from "../InfoTip";
import { deriveUnitPrice, unitShortLabel } from "../../../../utils/recipeUnits";
import {
	purchasePackSummary,
	shouldShowCupField,
	packSizeHelp,
	packUnitHelp,
	packPriceHelp,
	cupFieldNotNeededNote,
} from "../../../../utils/ingredientPurchase";
import "./EditIngredientModal.css";

const EditIngredientModal = ({
	isOpen,
	isSubmitting,
	formData,
	formErrors,
	categories,
	units,
	itemId,
	apiClient,
	onChange,
	onSubmit,
	onClose,
}) => {
	// The recipes this ingredient is used in. The portion per serving belongs
	// to the dish, so it is only shown here, never edited here. null means the
	// list has not arrived yet.
	const [recipes, setRecipes] = useState(null);

	useEffect(() => {
		if (!isOpen || !itemId || !apiClient) return undefined;
		let cancelled = false;
		apiClient
			.get(`/inventory/items/${itemId}/recipes`)
			.then((response) => {
				if (cancelled) return;
				setRecipes(response.data?.success ? response.data.data || [] : []);
			})
			.catch(() => {
				if (!cancelled) setRecipes([]);
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen, itemId, apiClient]);

	if (!isOpen) return null;

	// Pack edits also refresh the unit cost (see InventoryFormModal).
	const update = (field, value) => {
		const next = { ...formData, [field]: value };
		if (["pack_qty", "pack_unit", "pack_price", "unit", "grams_per_cup", "name"].includes(field)) {
			const derived = deriveUnitPrice({
				packQty: next.pack_qty,
				packUnit: next.pack_unit || next.unit,
				packPrice: next.pack_price,
				stockUnit: next.unit,
				gramsPerCup: next.grams_per_cup,
				ingredientName: next.name,
			});
			if (derived != null) next.price = String(derived);
		}
		onChange(next);
	};
	const close = () => {
		if (!isSubmitting) onClose();
	};

	const derivedUnitCost = deriveUnitPrice({
		packQty: formData.pack_qty,
		packUnit: formData.pack_unit || formData.unit,
		packPrice: formData.pack_price,
		stockUnit: formData.unit,
		gramsPerCup: formData.grams_per_cup,
		ingredientName: formData.name,
	});

	// Plain English summary of the purchase pack, so the owner can see what the
	// pack fields mean without reading every tooltip:
	//   "1 purchase pack = 1 kg, and it costs ₱300.00 → ₱300.00 per kg."
	const packSummary = purchasePackSummary({
		packQty: formData.pack_qty,
		packUnit: formData.pack_unit || formData.unit,
		packPrice: formData.pack_price,
		stockUnit: formData.unit,
		derivedUnitCost,
	});

	// "One cup weighs" only makes sense for items that are measured with cups.
	// The stored value is never thrown away, it is only hidden.
	const showCupField = shouldShowCupField({
		category: formData.category,
		stockUnit: formData.unit,
		packUnit: formData.pack_unit,
	});

	return (
		<InventoryModal
			className="modal-lg inventory-edit-modal"
			onClose={close}
			closeOnOverlay={false}
		>
			<div className="modal-header inventory-modal-header">
				<h3 className="modal-title">Edit Inventory Item</h3>
				<button className="modal-close-btn" onClick={close}>
					<FaTimes />
				</button>
			</div>

			<div className="modal-body inventory-modal-body">
				<div className="form-grid inventory-edit-form-grid">
					<div className="form-group">
						<label className="form-label">Item Name <span className="required-star">*</span></label>
						<input
							type="text"
							className={`form-input ${formErrors.name ? "error" : ""}`}
							value={formData.name}
							onChange={(event) => update("name", event.target.value)}
							placeholder="Enter item name"
						/>
						{formErrors.name && <span className="form-error">{formErrors.name}</span>}
					</div>

					<div className="form-group">
						<label className="form-label">
							Current Stock
							<InfoTip>
								The amount of this ingredient on hand right now, in the Stock Unit.
								It is locked here so an edit can never overwrite a stock movement
								that happened while this window was open. To change it, click the
								number in the Current Stock column of the list, or use Add Stock
								to receive new stock.
							</InfoTip>
						</label>
						<input
							type="text"
							inputMode="decimal"
							className="form-input form-input-locked"
							value={formData.quantity}
							onChange={(event) => update("quantity", event.target.value)}
							placeholder="e.g. 50"
							readOnly
						/>
						{formErrors.quantity && <span className="form-error">{formErrors.quantity}</span>}
						<span className="form-hint">
						</span>
					</div>

					<div className="form-group">
						<label className="form-label">
							Stock Unit
							<InfoTip>The unit used for current stock, recipe deductions, and unit cost. Use grams for powders/meat, mL for liquids, and pieces for discrete items.</InfoTip>
						</label>
						<select className="form-input" value={formData.unit} onChange={(event) => update("unit", event.target.value)}>
							{(units || []).map((unit) => (
								<option key={unit.id || unit.name} value={unit.name}>{unit.name}</option>
							))}
						</select>
					</div>

					<div className="form-group">
						<label className="form-label">Category <span className="required-star">*</span></label>
						<select
							className={`form-input ${formErrors.category ? "error" : ""}`}
							value={formData.category}
							onChange={(event) => update("category", event.target.value)}
						>
							<option value="">Select Category</option>
							{categories.filter((category) => category !== "All").map((category) => (
								<option key={category} value={category}>{category}</option>
							))}
							<option value="Other">Other</option>
						</select>
						{formErrors.category && <span className="form-error">{formErrors.category}</span>}
					</div>

					<div className="form-group">
						<label className="form-label">
							How much is in one purchase pack?
							<InfoTip>
								What one delivery holds, and what you pay for it. This is the
								purchase, not the recipe: a 250 g portion belongs in the Menu
								Builder, on the dish that uses this item.
							</InfoTip>
						</label>
						<input
							type="text"
							inputMode="decimal"
							className="form-input"
							value={formData.pack_qty}
							onChange={(event) => update("pack_qty", event.target.value)}
							placeholder="e.g. 1"
						/>
						<span className="form-hint">{packSizeHelp(formData.unit)}</span>
					</div>

					<div className="form-group">
						<label className="form-label">
							Purchase pack is measured in
							<InfoTip>{packUnitHelp}</InfoTip>
						</label>
						<select className="form-input" value={formData.pack_unit} onChange={(event) => update("pack_unit", event.target.value)}>
							<option value="">Same as stock unit</option>
							{(units || []).map((unit) => (
								<option key={unit.id || unit.name} value={unit.name}>{unit.name}</option>
							))}
						</select>
						<span className="form-hint">{packUnitHelp}</span>
					</div>

					<div className="form-group">
						<label className="form-label">
							Cost of one purchase pack (₱)
							<InfoTip>{packPriceHelp}</InfoTip>
						</label>
						<input
							type="number"
							className="form-input"
							value={formData.pack_price}
							onChange={(event) => update("pack_price", event.target.value)}
							placeholder="e.g. 300"
							min="0"
							step="0.01"
						/>
						<span className="form-hint">{packPriceHelp}</span>
					</div>

					<div className="form-group">
						<label className="form-label">
							Cost per {unitShortLabel(formData.unit)}
							{derivedUnitCost == null && <span className="required-star">*</span>}
							<InfoTip>
								What one {unitShortLabel(formData.unit)} of this ingredient costs.
								{derivedUnitCost != null
									? " Worked out from the purchase pack, so it is locked while the pack details are filled in."
									: " Fill in the purchase pack above and this is worked out for you, or type the cost yourself."}
							</InfoTip>
						</label>
						<input
							type="number"
							className={`form-input ${formErrors.price ? "error" : ""} ${derivedUnitCost != null ? "form-input-locked" : ""}`}
							value={formData.price}
							onChange={(event) => update("price", event.target.value)}
							placeholder="0.01"
							min="0"
							step="0.01"
							readOnly={derivedUnitCost != null}
						/>
						{formErrors.price && <span className="form-error">{formErrors.price}</span>}
					</div>

					{packSummary && (
						<div className="inventory-pack-summary">
							<div className="inventory-pack-summary-head">{packSummary.headline}</div>
							{packSummary.note && <div className="inventory-pack-summary-note">{packSummary.note}</div>}
						</div>
					)}

					<div className="inventory-recipes-panel">
						<div className="inventory-recipes-title">Used in recipes</div>
						<div className="inventory-recipes-hint">
							The portion per serving belongs to the dish, so it is set in the Menu Builder.
						</div>
						{recipes === null ? (
							<div className="inventory-recipes-empty">Loading the recipes…</div>
						) : recipes.length === 0 ? (
							<div className="inventory-recipes-empty">
								Not used in any recipe yet. Add it to a dish in the Menu Builder.
							</div>
						) : (
							<ul className="inventory-recipes-list">
								{recipes.map((line) => (
									<li key={`${line.product_id}-${line.unit || ""}`} className="inventory-recipes-row">
										<span className="inventory-recipes-dish">{line.product_name}</span>
										<span className="inventory-recipes-portion">
											{line.quantity_per_serving ?? "?"} {unitShortLabel(line.unit || "")} per serving
										</span>
									</li>
								))}
							</ul>
						)}
						<a className="inventory-recipes-link" href="?tab=product">Open the Menu Builder</a>
					</div>

					{showCupField ? (
						<div className="form-group">
							<label className="form-label">
								One cup weighs (grams)
								<InfoTip>
									Only needed for powders and dry goods you measure with cups or spoons:
									how many grams one cup holds, so "1 cup" can be turned into your
									Stock Unit when the recipe is costed.
								</InfoTip>
							</label>
							<input
								type="number"
								className="form-input"
								value={formData.grams_per_cup}
								onChange={(event) => update("grams_per_cup", event.target.value)}
								placeholder="e.g. 125 for all-purpose flour"
								min="0"
								step="0.1"
							/>
						</div>
					) : (
						<div className="form-group">
							<span className="form-hint inventory-cup-not-needed">{cupFieldNotNeededNote}</span>
						</div>
					)}

					<div className="form-group">
						<label className="form-label">Market Price</label>
						<input
							type="number"
							className="form-input"
							value={formData.market_price}
							onChange={(event) => update("market_price", event.target.value)}
							placeholder="0.00"
							min="0"
							step="0.01"
						/>
					</div>
				</div>
			</div>

			<div className="modal-footer inventory-modal-footer">
				<button className="btn-secondary" onClick={close} disabled={isSubmitting}>Cancel</button>
				<button className="btn-primary" onClick={onSubmit} disabled={isSubmitting}>
					{isSubmitting ? "Updating..." : <><FaSave /> Update Item</>}
				</button>
			</div>
		</InventoryModal>
	);
};

export default EditIngredientModal;
