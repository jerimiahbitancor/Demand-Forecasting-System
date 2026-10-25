import { useEffect, useState } from "react";
import { FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "../InventoryModal";
import InfoTip from "../InfoTip";
import { unitShortLabel } from "../../../../utils/recipeUnits";
import { formatStockQty } from "../../../../utils/formatStockQty.js";
import "./EditIngredientModal.css";

const EditIngredientModal = ({
	isOpen,
	isSubmitting,
	formData,
	formErrors,
	categories,
	units,
	itemId,
	openShortfall = 0,
	openShortfallSales = 0,
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

	const update = (field, value) => {
		onChange({ ...formData, [field]: value });
	};
	const close = () => {
		if (!isSubmitting) onClose();
	};

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
							{openShortfall > 0
								? `${formatStockQty(openShortfall, formData.unit)} ${formData.unit || 'pcs'} is still short from `
									+ `${openShortfallSales === 1 ? '1 sale' : `${openShortfallSales} sales`}. `
									+ 'A stock count clears it: set the number in the Current Stock column of the list.'
								: 'Change it in the Current Stock column of the list (a stock count), or use Add Stock to receive new stock.'}
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
							Cost per {unitShortLabel(formData.unit)}
							<span className="required-star">*</span>
							<InfoTip>
								What one {unitShortLabel(formData.unit)} of this ingredient costs.
								{" "}Enter the cost per stock unit.
							</InfoTip>
						</label>
						<input
							type="number"
							className={`form-input ${formErrors.price ? "error" : ""}`}
							value={formData.price}
							onChange={(event) => update("price", event.target.value)}
							placeholder="0.01"
							min="0"
							step="0.01"
						/>
						{formErrors.price && <span className="form-error">{formErrors.price}</span>}
					</div>

					<div className="form-group">
						<label className="form-label">Material Type</label>
						<select className="form-input" value={formData.material_type || 'dry'} onChange={(event) => update("material_type", event.target.value)}>
							<option value="wet">Wet Raw Materials</option>
							<option value="dry">Dry Raw Materials</option>
						</select>
					</div>

					<div className="form-group">
						<label className="form-label">
							Ideal Stock Level ({unitShortLabel(formData.unit)})
							<span className="required-star">*</span>
							<InfoTip>
								The amount you normally want on hand. Current Stock Level Status is
								{" "}stock ÷ ideal stock level: Low Stock below{" "}
								{formData.material_type === "wet" ? "50% (wet raw materials)" : "20% (dry raw materials)"} by
								{" "}default, Normal up to 100%, Excess above 100%. The percentages can be changed in Settings.
							</InfoTip>
						</label>
						<input
							type="number"
							className={`form-input ${formErrors.min_stock ? "error" : ""}`}
							value={formData.min_stock ?? ""}
							onChange={(event) => update("min_stock", event.target.value)}
							placeholder="e.g. 40"
							min="0"
							step="any"
						/>
						{formErrors.min_stock && <span className="form-error">{formErrors.min_stock}</span>}
					</div>
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
