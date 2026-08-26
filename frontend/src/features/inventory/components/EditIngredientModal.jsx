import { FaSave, FaTimes } from "react-icons/fa";
import InventoryModal from "./InventoryModal";
import "./EditIngredientModal.css";

const EditIngredientModal = ({
	isOpen,
	isSubmitting,
	formData,
	formErrors,
	categories,
	onChange,
	onSubmit,
	onClose,
}) => {
	if (!isOpen) return null;

	const update = (field, value) => onChange({ ...formData, [field]: value });
	const close = () => {
		if (!isSubmitting) onClose();
	};

	return (
		<InventoryModal className="modal-lg inventory-edit-modal" onClose={close}>
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
						<label className="form-label">Unit</label>
						<select className="form-input" value={formData.unit} onChange={(event) => update("unit", event.target.value)}>
							<option value="kg">Kilogram (kg)</option>
							<option value="g">Gram (g)</option>
							<option value="L">Liter (L)</option>
							<option value="mL">Milliliter (mL)</option>
							<option value="pcs">Pieces (pcs)</option>
							<option value="box">Box</option>
							<option value="pack">Pack</option>
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
						<label className="form-label">Unit Cost <span className="required-star">*</span></label>
						<input type="number" className={`form-input ${formErrors.price ? "error" : ""}`} value={formData.price} onChange={(event) => update("price", event.target.value)} placeholder="0.00" min="0" step="0.01" />
						{formErrors.price && <span className="form-error">{formErrors.price}</span>}
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
