// components/MappingData.jsx
import { useState } from "react";
import { 
  FiPlus, 
  FiEdit2, 
  FiTrash2, 
  FiChevronLeft,
  FiChevronRight,
  FiX,
  FiSave
} from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./MappingData.css";

const MappingData = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sortBy, setSortBy] = useState("Newest First");
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sample mapping data
  const [mappingData, setMappingData] = useState([
    { id: 1, productName: "Tonkatsu", ingredient: "Pork Loin, Breadcrumbs, Egg", price: "₱250" },
    { id: 2, productName: "Sisig", ingredient: "Pork Face, Liver, Onions, Chili", price: "₱180" },
    { id: 3, productName: "Tapsilog", ingredient: "Beef Tapa, Garlic Rice, Egg", price: "₱150" },
    { id: 4, productName: "Chicken Poppers", ingredient: "Chicken, Breading, Sweet Chili", price: "₱185" },
    { id: 5, productName: "Adobo", ingredient: "Chicken, Soy Sauce, Vinegar, Garlic", price: "₱220" },
    { id: 6, productName: "Sinigang", ingredient: "Pork, Tamarind, Vegetables", price: "₱195" },
    { id: 7, productName: "Lechon Kawali", ingredient: "Pork Belly, Salt, Pepper", price: "₱210" },
    { id: 8, productName: "Halo-Halo", ingredient: "Ice, Milk, Fruits, Beans, Leche Flan", price: "₱120" },
    { id: 9, productName: "Pancit Canton", ingredient: "Noodles, Vegetables, Chicken", price: "₱160" },
    { id: 10, productName: "Lumpia", ingredient: "Pork, Vegetables, Wrapper", price: "₱140" },
    { id: 11, productName: "Kare-Kare", ingredient: "Oxtail, Peanut Sauce, Vegetables", price: "₱280" },
    { id: 12, productName: "Bicol Express", ingredient: "Pork, Coconut Milk, Chili", price: "₱200" },
  ]);

  // New mapping form state
  const [newMapping, setNewMapping] = useState({
    productName: "",
    price: "",
    ingredients: []
  });

  const [newIngredient, setNewIngredient] = useState({
    name: "",
    quantity: "",
    unit: "kg"
  });

  const handleAddMapping = () => {
    if (newMapping.productName && newMapping.price) {
      const newId = mappingData.length + 1;
      const ingredientNames = newMapping.ingredients.map(ing => ing.name).join(", ");
      setMappingData([...mappingData, {
        id: newId,
        productName: newMapping.productName,
        ingredient: ingredientNames,
        price: `₱${newMapping.price}`
      }]);
      
      // Reset form and close modal
      setNewMapping({ productName: "", price: "", ingredients: [] });
      setNewIngredient({ name: "", quantity: "", unit: "kg" });
      setIsModalOpen(false);
    }
  };

  const handleAddIngredient = () => {
    if (newIngredient.name && newIngredient.quantity) {
      setNewMapping({
        ...newMapping,
        ingredients: [...newMapping.ingredients, { ...newIngredient }]
      });
      setNewIngredient({ name: "", quantity: "", unit: "kg" });
    }
  };

  // Remove ingredient from list
  const handleRemoveIngredient = (index) => {
    const updatedIngredients = newMapping.ingredients.filter((_, i) => i !== index);
    setNewMapping({ ...newMapping, ingredients: updatedIngredients });
  };

  const handleDeleteMapping = (id) => {
    if (window.confirm('Are you sure you want to delete this mapping?')) {
      setMappingData(mappingData.filter(item => item.id !== id));
    }
  };

  // Filter mapping data based on search
  const filteredData = mappingData.filter(item =>
    item.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.ingredient.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination
  const itemsPerPage = 5;
  const totalPages = Math.ceil(sortedData.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = sortedData.slice(startIndex, startIndex + itemsPerPage);

  // Get page numbers for pagination
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
        <h2 className="mapping-title">Current Ingredient Mapping ({mappingData.length} Active Products)</h2>
        <button 
          className="btn-upload"
          onClick={() => setIsModalOpen(true)}
        >
          <FiPlus size={16} /> Upload New Mapping
        </button>
      </div>

      {/* Search and Filter */}
      <div className="mapping-controls">
        <div className="search-wrapper">
          <FiSearch className="search-icon" />
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
          <button className="btn-refresh" onClick={fetchData} disabled={loading}>
            <FiRefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>

      {/* Product Mapping Table */}
      <div className="mapping-section">
        <div className="mapping-table-wrapper">
          <table className="mapping-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Product Name</th>
                <th>Ingredient</th>
                <th>Price</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {currentData.map((item, index) => (
                <tr key={item.id}>
                  <td>{startIndex + index + 1}</td>
                  <td>{item.productName}</td>
                  <td>{item.ingredient}</td>
                  <td>{item.price}</td>
                  <td>
                    <button className="action-btn edit">
                      <FiEdit2 size={16} />
                    </button>
                    <button 
                      className="action-btn delete"
                      onClick={() => handleDeleteMapping(item.id)}
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                className={`page-number ${page === currentPage ? 'active' : ''} ${page === '...' ? 'dots' : ''}`}
                onClick={() => typeof page === 'number' && setCurrentPage(page)}
                disabled={page === '...'}
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

      {/* Modal for Add New Mapping */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Mapping</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                <FiX size={24} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Product Name</label>
                <input
                  type="text"
                  placeholder="Enter product name"
                  value={newMapping.productName}
                  onChange={(e) => setNewMapping({...newMapping, productName: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label>Product Price</label>
                <input
                  type="text"
                  placeholder="Enter product price"
                  value={newMapping.price}
                  onChange={(e) => setNewMapping({...newMapping, price: e.target.value})}
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
                    placeholder="Qty"
                    className="ingredient-qty-input"
                    value={newIngredient.quantity}
                    onChange={(e) => setNewIngredient({...newIngredient, quantity: e.target.value})}
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
                    <option value="cup">cup</option>
                    <option value="oz">oz</option>
                    <option value="lb">lb</option>
                  </select>
                  <button className="btn-add-ingredient" onClick={handleAddIngredient}>
                    <FiPlus size={16} /> Add
                  </button>
                </div>

                {/* Ingredients Table */}
                <div className={`ingredients-table-wrapper ${formErrors.ingredients ? 'error-border' : ''}`}>
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
                                title="Remove ingredient"
                              >
                                <FiTrash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {formErrors.ingredients && (
                    <span className="error-text" style={{ padding: '8px 12px', display: 'block' }}>
                      {formErrors.ingredients}
                    </span>
                  )}
                </div>

                {formError && (
                  <p style={{ color: "var(--color-error)", fontSize: "13px", marginTop: "8px" }}>
                    {formError}
                  </p>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Discard
              </button>
              <button className="btn-primary" onClick={handleAddMapping}>
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