// components/MappingData.jsx
import { useState, useEffect } from "react";
import {
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiChevronLeft,
  FiChevronRight,
  FiX,
  FiSave,
} from "react-icons/fi";
import "./MappingData.css";
import { productService } from "../../../services/productService";
import { useToast } from "../../components/Toast/use_toast";
import Toast from "../../components/Toast/Toast";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

const EMPTY_FORM = {
  id: null,
  productName: "",
  category: "",
  price: "",
  ingredients: [],
};

const EMPTY_INGREDIENT = { name: "", quantity: "", unit: "kg" };

const MappingData = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("Newest First");
  const [currentPage, setCurrentPage] = useState(1);

  // Modal + form state — "add" and "edit" share one modal, driven by modalMode.
  const [modalMode, setModalMode] = useState(null); // null | "add" | "edit"
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [newIngredient, setNewIngredient] = useState(EMPTY_INGREDIENT);
  const [formError, setFormError] = useState("");

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState(null);

  // Live data from the backend
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const { toast, showToast, dismissToast } = useToast();

  const loadProducts = async () => {
    try {
      setIsLoading(true);
      const data = await productService.getAll();
      setProducts(data);
      setLoadError("");
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  // ---------- Modal open/close helpers ----------

  const openAddModal = () => {
    setFormData(EMPTY_FORM);
    setNewIngredient(EMPTY_INGREDIENT);
    setFormError("");
    setModalMode("add");
  };

  const openEditModal = (item) => {
    setFormData({
      id: item.id,
      productName: item.name,
      category: item.category,
      price: item.price,
      ingredients: item.ingredients.map((ing) => ({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
      })),
    });
    setNewIngredient(EMPTY_INGREDIENT);
    setFormError("");
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setFormData(EMPTY_FORM);
    setFormError("");
  };

  // ---------- Ingredient row helpers (inside the modal) ----------

  const handleAddIngredient = () => {
    const name = newIngredient.name.trim();
    const quantity = Number(newIngredient.quantity);

    if (!name || !newIngredient.quantity) {
      setFormError("Enter both an ingredient name and a quantity.");
      return;
    }
    if (isNaN(quantity) || quantity <= 0) {
      setFormError("Quantity must be a positive number.");
      return;
    }
    // Mirrors the backend's own duplicate check (ProductController._buildMappingRows)
    // so the user sees the error immediately instead of after a round trip.
    const alreadyAdded = formData.ingredients.some(
      (ing) => ing.name.toLowerCase() === name.toLowerCase()
    );
    if (alreadyAdded) {
      setFormError(`"${name}" was already added to this product.`);
      return;
    }

    setFormData({
      ...formData,
      ingredients: [...formData.ingredients, { ...newIngredient, name, quantity }],
    });
    setNewIngredient(EMPTY_INGREDIENT);
    setFormError("");
  };

  const handleRemoveIngredient = (index) => {
    setFormData({
      ...formData,
      ingredients: formData.ingredients.filter((_, i) => i !== index),
    });
  };

  // ---------- Save (create or update) ----------

  const handleSaveMapping = async () => {
    if (!formData.productName.trim() || !formData.category.trim() || !formData.price) {
      setFormError("Product name, category, and price are required.");
      return;
    }
    if (isNaN(Number(formData.price)) || Number(formData.price) <= 0) {
      setFormError("Price must be a positive number.");
      return;
    }

    const payload = {
      name: formData.productName.trim(),
      category: formData.category.trim(),
      price: Number(formData.price),
      ingredients: formData.ingredients,
    };

    try {
      const response =
        modalMode === "edit"
          ? await productService.update(formData.id, payload)
          : await productService.create(payload);

      // Step 2 of the UX spec: close the modal instantly, don't wait on the toast.
      closeModal();
      showToast(response.message);
      loadProducts();
    } catch (err) {
      // Keep the modal open so the user doesn't lose their input on a validation error.
      setFormError(err.message);
    }
  };

  // ---------- Delete ----------

  const confirmDelete = async () => {
    try {
      const response = await productService.remove(pendingDelete.id);
      setPendingDelete(null);
      showToast(response.message);
      loadProducts();
    } catch (err) {
      setPendingDelete(null);
      showToast(err.message, "error");
    }
  };

  // ---------- Search, sort, paginate ----------

  const filteredData = products.filter((item) => {
    const term = searchTerm.toLowerCase();
    const ingredientNames = item.ingredients.map((ing) => ing.name).join(", ");
    return (
      item.name.toLowerCase().includes(term) ||
      ingredientNames.toLowerCase().includes(term)
    );
  });

  const sortedData = [...filteredData].sort((a, b) => {
    switch (sortBy) {
      case "Oldest First":
        return new Date(a.created_at) - new Date(b.created_at);
      case "Price: Low to High":
        return a.price - b.price;
      case "Price: High to Low":
        return b.price - a.price;
      case "A-Z":
        return a.name.localeCompare(b.name);
      case "Newest First":
      default:
        return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  const itemsPerPage = 5;
  const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = sortedData.slice(startIndex, startIndex + itemsPerPage);

  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="mapping-container">
      {/* Header */}
      <div className="mapping-header">
        <h2 className="mapping-title">
          Current Ingredient Mapping ({products.length} Active Products)
        </h2>
        <button className="btn-upload" onClick={openAddModal}>
          <FiPlus size={16} /> Upload New Mapping
        </button>
      </div>

      {/* Search and Filter */}
      <div className="mapping-controls">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search product or ingredient..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        <div className="sort-wrapper">
          <label>Sort By:</label>
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option>Newest First</option>
            <option>Oldest First</option>
            <option>Price: Low to High</option>
            <option>Price: High to Low</option>
            <option>A-Z</option>
          </select>
        </div>
      </div>

      {/* Product Mapping Table */}
      <div className="mapping-section">
        <div className="mapping-table-wrapper">
          {isLoading ? (
            <p style={{ padding: "24px", textAlign: "center" }}>Loading products…</p>
          ) : loadError ? (
            <p style={{ padding: "24px", textAlign: "center", color: "var(--color-error)" }}>
              {loadError}
            </p>
          ) : (
            <table className="mapping-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Product Name</th>
                  <th>Category</th>
                  <th>Ingredient</th>
                  <th>Price</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentData.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-row">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  currentData.map((item, index) => (
                    <tr key={item.id}>
                      <td>{startIndex + index + 1}</td>
                      <td>{item.name}</td>
                      <td>{item.category}</td>
                      <td>{item.ingredients.map((ing) => ing.name).join(", ")}</td>
                      <td>₱{item.price}</td>
                      <td>
                        <button className="action-btn edit" onClick={() => openEditModal(item)}>
                          <FiEdit2 size={16} />
                        </button>
                        <button
                          className="action-btn delete"
                          onClick={() => setPendingDelete(item)}
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="pagination">
          <div className="pagination-left">
            <button
              className="page-btn"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              <FiChevronLeft size={16} /> Previous
            </button>
          </div>
          <div className="pagination-center">
            {getPageNumbers().map((page, index) => (
              <button
                key={index}
                className={`page-number ${page === currentPage ? "active" : ""} ${
                  page === "..." ? "dots" : ""
                }`}
                onClick={() => typeof page === "number" && setCurrentPage(page)}
                disabled={page === "..."}
              >
                {page}
              </button>
            ))}
          </div>
          <div className="pagination-right">
            <button
              className="page-btn"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              Next <FiChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal for Add / Edit Mapping */}
      {modalMode && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modalMode === "edit" ? "Edit Mapping" : "Add New Mapping"}</h3>
              <button className="modal-close" onClick={closeModal}>
                <FiX size={24} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Product Name</label>
                <input
                  type="text"
                  placeholder="Enter product name"
                  value={formData.productName}
                  onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Product Category</label>
                <input
                  type="text"
                  placeholder="Enter product category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Product Price</label>
                <input
                  type="number"
                  placeholder="Enter product price"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Ingredients</label>

                {/* Ingredient Input Row */}
                <div className="ingredient-input-row">
                  <input
                    type="text"
                    placeholder="Ingredient Name"
                    className="ingredient-name-input"
                    value={newIngredient.name}
                    onChange={(e) => setNewIngredient({ ...newIngredient, name: e.target.value })}
                  />
                  <input
                    type="number"
                    placeholder="Quantity"
                    className="ingredient-qty-input"
                    value={newIngredient.quantity}
                    onChange={(e) =>
                      setNewIngredient({ ...newIngredient, quantity: e.target.value })
                    }
                  />
                  <select
                    className="ingredient-unit-select"
                    value={newIngredient.unit}
                    onChange={(e) => setNewIngredient({ ...newIngredient, unit: e.target.value })}
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="mL">mL</option>
                    <option value="pcs">pcs</option>
                    <option value="tbsp">tbsp</option>
                    <option value="tsp">tsp</option>
                  </select>
                  <button className="btn-add-ingredient" onClick={handleAddIngredient}>
                    <FiPlus size={16} /> Add
                  </button>
                </div>

                {/* Ingredients Table */}
                <div className="ingredients-table-wrapper">
                  <table className="ingredients-modal-table">
                    <thead>
                      <tr>
                        <th>Ingredient Name</th>
                        <th>Quantity</th>
                        <th>Unit</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.ingredients.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="empty-row">
                            No ingredients added yet
                          </td>
                        </tr>
                      ) : (
                        formData.ingredients.map((ing, index) => (
                          <tr key={index}>
                            <td>{ing.name}</td>
                            <td>{ing.quantity}</td>
                            <td>{ing.unit}</td>
                            <td>
                              <button
                                className="action-btn delete"
                                onClick={() => handleRemoveIngredient(index)}
                              >
                                <FiTrash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {formError && (
                  <p style={{ color: "var(--color-error)", fontSize: "13px", marginTop: "8px" }}>
                    {formError}
                  </p>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModal}>
                Discard
              </button>
              <button className="btn-primary" onClick={handleSaveMapping}>
                <FiSave size={16} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <ConfirmDeleteModal
          productName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      {/* Toast notifications */}
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
};

export default MappingData;