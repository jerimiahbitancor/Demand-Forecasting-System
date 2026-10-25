// ForecastConfig.jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import { FiEdit2, FiInfo, FiPlus, FiTrash, FiX } from 'react-icons/fi';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import { useAuth } from '../../../context/AuthContext';
import { setUnitMetadata } from '../../../utils/recipeUnits';
import './ForecastConfig.css';
import '../../inventory/pages/Inventory.css';
import { buildPageItems, ELLIPSIS } from '../../../utils/pagination';
import STOCK_RULES from '../../../../../shared/stockStatusRules.json' with { type: 'json' };

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const NAME_LABELS = {
  category: 'Category',
  unit: 'Unit',
};

// Stock level thresholds: defaults and limits come from the same file the
// backend uses (shared/stockStatusRules.json); the backend validates again.
const DEFAULT_THRESHOLDS = STOCK_RULES.defaults;
const THRESHOLD_LIMITS = STOCK_RULES.limits;
const STATUS_LABELS = STOCK_RULES.current.labels;
const PREDICTED_LABELS = STOCK_RULES.predicted.labels;

// A new unit must say what kind it is so recipe costing can convert it.
const EMPTY_UNIT_FORM = { family: '', baseFactor: '', isPiece: false, pieceWeight: '', aliases: '' };

function ForecastConfig() {
  const { getToken } = useAuth();
  const [value, setValue] = useState(15);
  const [foodCostThreshold, setFoodCostThreshold] = useState(35);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [thresholdsSaved, setThresholdsSaved] = useState(true);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  // false until migration 022 adds current_excess_pct (Excess Stock threshold).
  const [excessSaved, setExcessSaved] = useState(true);
  const [categoryTab, setCategoryTab] = useState('ingredient');
  const [unitTab, setUnitTab] = useState('ingredient');
  const [categoryData, setCategoryData] = useState({ ingredient: [], product: [] });
  const [unitData, setUnitData] = useState({ ingredient: [] });
  const [managementPage, setManagementPage] = useState({});
  const [managementDialog, setManagementDialog] = useState(null);
  const [managementValue, setManagementValue] = useState('');
  const [unitForm, setUnitForm] = useState(EMPTY_UNIT_FORM);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Axios instance
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    async (config) => {
      const token = await getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  const fetchManagementData = async () => {
    try {
      const [categoryResponse, unitResponse, productCategoryResponse] = await Promise.all([
        apiClient.get('/categories?includeMeta=true'),
        apiClient.get('/units'),
        apiClient.get('/product-categories')
      ]);
      if (categoryResponse.data.success) {
        setCategoryData((currentData) => ({ ...currentData, ingredient: categoryResponse.data.data || [] }));
      }
      if (unitResponse.data.success) {
        setUnitMetadata(unitResponse.data.data || []);
        setUnitData({ ingredient: unitResponse.data.data || [] });
      }
      if (productCategoryResponse.data.success) {
        setCategoryData((currentData) => ({ ...currentData, product: productCategoryResponse.data.data || [] }));
      }
    } catch (error) {
      console.error('Error fetching management data:', error);
      toast.error('Failed to load categories and units.');
    }
  };

  const fetchForecastConfig = async () => {
    try {
      const response = await apiClient.get('/settings/forecast-config');
      if (response.data.success) {
        const config = response.data.data;
        if (config.safety_buffer_percentage != null) setValue(config.safety_buffer_percentage);
        if (config.food_cost_warning_threshold != null) setFoodCostThreshold(config.food_cost_warning_threshold);
        const loaded = {};
        for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
          loaded[key] = config[key] != null ? Number(config[key]) : DEFAULT_THRESHOLDS[key];
        }
        setThresholds(loaded);
        setThresholdsSaved(config.stock_thresholds_saved !== false);
        setExcessSaved(config.excess_threshold_saved !== false);
      }
    } catch (error) {
      console.error('Error fetching forecast config:', error);
      // Keep the defaults (15%, 35%) — the config row may not exist yet.
    }
  };

  useEffect(() => {
    Promise.resolve().then(fetchManagementData);
    Promise.resolve().then(fetchForecastConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const response = await apiClient.post('/settings/forecast-config', {
        safety_buffer_percentage: value,
        food_cost_warning_threshold: foodCostThreshold,
      });
      if (response.data.success) {
        toast.success('Forecast configuration saved.');
      } else {
        toast.error('Failed to save configuration.');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save configuration.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Quick check before sending, so the owner sees the problem at once. The
  // backend checks the same rules (utils/stockStatus.js validateThresholds).
  const thresholdProblem = (values) => {
    for (const [key, { min, max }] of Object.entries(THRESHOLD_LIMITS)) {
      const value = Number(values[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        return `Each threshold must be a number from ${min} to ${max}.`;
      }
    }
    if (!(values.current_excess_pct > values.current_low_wet_pct && values.current_excess_pct > values.current_low_dry_pct)) {
      return 'Excess Stock must start above both Low Stock thresholds.';
    }
    if (!(values.predicted_critical_pct < values.predicted_sufficient_pct)) {
      return 'Critical Shortage must be lower than Sufficient Supply.';
    }
    if (!(values.predicted_sufficient_pct < values.predicted_above_pct)) {
      return 'Sufficient Supply must be lower than Above Forecast Limit.';
    }
    return null;
  };

  const handleSaveThresholds = async () => {
    const problem = thresholdProblem(thresholds);
    if (problem) {
      toast.error(problem);
      return;
    }
    setIsSavingThresholds(true);
    try {
      const response = await apiClient.post('/settings/forecast-config', { ...thresholds });
      if (response.data.success) {
        setThresholdsSaved(true);
        toast.success('Stock level thresholds saved. Stock statuses now use the new values.');
      } else {
        toast.error(response.data.error || 'Failed to save stock level thresholds.');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save stock level thresholds.');
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const setThreshold = (key, raw) => {
    setThresholds((current) => ({ ...current, [key]: raw === '' ? '' : Number(raw) }));
  };

  // A labelled % box for one threshold ("Wet [50] %").
  const pctInput = (key, label, aria) => (
    <label className="fc-status-input">
      <small>{label}</small>
      <input
        type="number"
        min={THRESHOLD_LIMITS[key].min}
        max={THRESHOLD_LIMITS[key].max}
        step="1"
        value={thresholds[key]}
        onChange={(e) => setThreshold(key, e.target.value)}
        aria-label={`${aria} (%)`}
      />
      <span aria-hidden="true">%</span>
    </label>
  );

  const openManagementDialog = (type, mode, item = '') => {
    const activeTab = type === 'category' ? categoryTab : unitTab;
    setManagementDialog({ type, mode, activeTab, originalValue: item });
    setManagementValue(item.name || item);
    setUnitForm(EMPTY_UNIT_FORM);
  };

  const getEndpoint = (type, activeTab) => {
    if (type === 'category') {
      return activeTab === 'product' ? '/product-categories' : '/categories';
    }
    return '/units';
  };

  const handleManagementSubmit = (event) => {
    event.preventDefault();
    const nextValue = managementValue.trim();
    const isCategory = managementDialog.type === 'category';
    if (!nextValue) {
      toast.error(isCategory ? 'Category name is required' : 'Unit is required');
      return;
    }
    const activeTab = managementDialog.activeTab;
    const endpoint = getEndpoint(managementDialog.type, activeTab);
    let newBody = { name: nextValue };
    if (!isCategory && managementDialog.mode === 'new') {
      const { family, baseFactor, isPiece, pieceWeight, aliases } = unitForm;
      if (!family) {
        toast.error('Choose what kind of unit this is');
        return;
      }
      newBody = { name: nextValue, family, aliases };
      if (family === 'count') {
        newBody.is_piece = isPiece;
        if (isPiece && pieceWeight !== '') newBody.piece_weight_grams = Number(pieceWeight);
      } else {
        if (!(Number(baseFactor) > 0)) {
          toast.error(`Enter how many ${family === 'mass' ? 'grams' : 'mL'} are in 1 ${nextValue}`);
          return;
        }
        newBody.base_factor = Number(baseFactor);
      }
    }
    const request = managementDialog.mode === 'new'
      ? apiClient.post(endpoint, newBody)
      : apiClient.put(`${endpoint}/${managementDialog.originalValue.id}`, { name: nextValue });
    request.then(() => {
      setManagementDialog(null);
      return fetchManagementData();
    }).then(() => toast.success(`${managementDialog.mode === 'new' ? 'Added' : 'Updated'} ${isCategory ? 'category' : 'unit'}.`))
      .catch((error) => toast.error(error.response?.data?.error || `Failed to save ${isCategory ? 'category' : 'unit'}.`));
  };

  const handleManagementDelete = async () => {
    if (!deleteDialog) return;
    const { type, activeTab, item } = deleteDialog;
    const nameLabel = NAME_LABELS[type] || 'item';
    setIsDeleting(true);
    try {
      const response = await apiClient.delete(`${getEndpoint(type, activeTab)}/${item.id}`);
      setDeleteDialog(null);
      await fetchManagementData();
      toast.success(response.data?.message || `${nameLabel} deleted.`);
    } catch (error) {
      toast.error(error.response?.data?.error || `Failed to delete ${nameLabel.toLowerCase()}.`);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderDialogTitle = () => {
    const mode = managementDialog.mode === 'new' ? 'Add' : 'Edit';
    const name = NAME_LABELS[managementDialog.type] || 'item';
    return `${mode} ${name}`;
  };

  const renderDialogContext = () => {
    if (managementDialog.type === 'unit' || managementDialog.activeTab === 'ingredient') {
      return 'Ingredient Management';
    }
    return 'Product Management';
  };

  const renderManagementCard = (type, title, subtitle, activeTab, setActiveTab, data, columnLabel, tabs = [['ingredient', 'Ingredient Management'], ['product', 'Product Management']], pageSize = null) => {
    const items = data[activeTab] || [];
    const totalItems = items.length;
    const enablePagination = pageSize > 0 && totalItems > pageSize;
    const totalPages = enablePagination ? Math.max(1, Math.ceil(totalItems / pageSize)) : 1;
    const currentPage = enablePagination ? Math.min(managementPage[type] || 1, totalPages) : 1;
    const pageItems = enablePagination ? items.slice((currentPage - 1) * pageSize, currentPage * pageSize) : items;
    const goToPage = (page) => {
      setManagementPage((prev) => ({ ...prev, [type]: page }));
    };

    return (
    <article className="fc-card fc-management-card">
      <div className="fc-management-header">
        <div>
          <h2 className="fc-title">{title}</h2>
          <p className="fc-subtitle">{subtitle}</p>
        </div>
        <button type="button" className="fc-new-button" onClick={() => openManagementDialog(type, 'new')}>
          <FiPlus aria-hidden="true" /> New
        </button>
      </div>
      <div className={`fc-management-tabs ${tabs.length === 1 ? 'single' : ''}`} role="tablist">
        {tabs.map(([tab, label]) => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {label}
          </button>
        ))}
      </div>
      <div className="fc-management-table-wrap">
        <table className="fc-management-table">
          <thead><tr><th>{columnLabel}</th><th>Actions</th></tr></thead>
          <tbody>
            {pageItems.map((item) => (
              <tr key={item.id || item.name}>
                <td>{item.name || item}</td>
                <td>
                  <div className="fc-row-actions">
                    <button type="button" className="fc-edit-button" aria-label={`Edit ${item.name || item}`} onClick={() => openManagementDialog(type, 'edit', item)}><FiEdit2 aria-hidden="true" /></button>
                    <button type="button" className="fc-delete-button" aria-label={`Delete ${item.name || item}`} onClick={() => setDeleteDialog({ type, activeTab, item })}><FiTrash aria-hidden="true" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 4 - pageItems.length) }).map((_, index) => <tr className="fc-empty-row" key={`empty-${index}`}><td></td><td></td></tr>)}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="inventory-pagination">
          <span className="inventory-pagination-info">
            Showing {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, totalItems)} of {totalItems} items
          </span>
          <div className="inventory-pagination-controls">
            <button
              className="inventory-pagination-btn"
              onClick={() => goToPage(Math.max(currentPage - 1, 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <FaArrowLeft /> Previous
            </button>
            <div className="inventory-pagination-numbers">
              {buildPageItems(currentPage, totalPages).map((item, index) =>
                item === ELLIPSIS ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="inventory-pagination-ellipsis"
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    className={`inventory-pagination-number ${currentPage === item ? 'active' : ''}`}
                    onClick={() => goToPage(item)}
                    aria-label={`Page ${item}`}
                    aria-current={currentPage === item ? 'page' : undefined}
                  >
                    {item}
                  </button>
                )
              )}
            </div>
            <button
              className="inventory-pagination-btn"
              onClick={() => goToPage(Math.min(currentPage + 1, totalPages))}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              Next <FaArrowRight />
            </button>
          </div>
          <div className="inventory-pagination-anchor" aria-hidden="true"></div>
        </div>
      )}
    </article>
  );
  };

  return (
    <section className="fc-root">
      <div className="fc-inner">
        <div className="fc-card fc-left">
          <div className="fc-title-row">
            <h2 className="fc-title">Safety Buffer Percentage</h2>
            <Tippy
              content={(
                <div className="fc-tooltip-content">
                  <strong>This safety buffer covers:</strong>
                  <ul>
                    <li>Unexpected customer demand (walk-ins, spikes)</li>
                    <li>Staff meals not recorded in your POS system</li>
                  </ul>
                  <p><strong>Higher buffer</strong> = Less risk of stockout, more potential waste</p>
                  <p><strong>Lower buffer</strong> = Less waste, higher risk of stockout</p>
                  <p><strong>Default:</strong> 15%<br /><strong>Recommended:</strong> 10–20%</p>
                </div>
              )}
              placement="top"
              animation="scale"
              duration={200}
              theme="dark"
              arrow={true}
              delay={[100, 0]}
              maxWidth={360}
              interactive={true}
              trigger="mouseenter focus click"
            >
              <button type="button" className="fc-info-button" aria-label="Explain safety buffer">
                <FiInfo aria-hidden="true" />
              </button>
            </Tippy>
          </div>
          <div className="fc-desc-card">
            <strong>Description:</strong> Additional allowance for forecasted ingredient demand.
          </div>

          <div className="fc-control-card">
            <div className="fc-slider-row">
              <div className="fc-slider-value-row">
                <div className="fc-percent">[{value}%]</div>
                <input className="fc-slider" type="range" min="0" max="50" value={value} onChange={(e) => setValue(Number(e.target.value))} />
                <div className="fc-adjust-controls">
                  <button type="button" onClick={() => setValue(Math.min(50, value + 1))} aria-label="Increase safety buffer">+</button>
                  <button type="button" onClick={() => setValue(Math.max(0, value - 1))} aria-label="Decrease safety buffer">-</button>
                </div>
              </div>
              <div className="fc-scale">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
            </div>
          </div>

          <button
            className="fc-save"
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? 'SAVING…' : 'SAVE CONFIGURATION'}
          </button>
        </div>

        <div className="fc-card fc-left">
          <div className="fc-title-row">
            <h2 className="fc-title">High Food Cost Warning Threshold</h2>
            <Tippy
              content={(
                <div className="fc-tooltip-content">
                  <strong>Food Cost Percentage = (COGS ÷ Selling Price) × 100</strong>
                  <p>A product is flagged "High Food Cost" once its Food Cost Percentage
                    exceeds this threshold — a warning indicator to review price, recipe,
                    portion size, or sourcing, not an automatic profitability verdict.</p>
                  <p><strong>Default:</strong> 35%</p>
                </div>
              )}
              placement="top"
              animation="scale"
              duration={200}
              theme="dark"
              arrow={true}
              delay={[100, 0]}
              maxWidth={360}
              interactive={true}
              trigger="mouseenter focus click"
            >
              <button type="button" className="fc-info-button" aria-label="Explain food cost threshold">
                <FiInfo aria-hidden="true" />
              </button>
            </Tippy>
          </div>
          <div className="fc-desc-card">
            <strong>Description:</strong> Products whose ingredient cost exceeds this percentage
            of their selling price are flagged in Inventory Management &gt; Product Management.
          </div>

          <div className="fc-control-card">
            <div className="fc-slider-row">
              <div className="fc-slider-value-row">
                <div className="fc-percent">[{foodCostThreshold}%]</div>
                <input
                  className="fc-slider"
                  type="range"
                  min="1"
                  max="100"
                  value={foodCostThreshold}
                  onChange={(e) => setFoodCostThreshold(Number(e.target.value))}
                />
                <div className="fc-adjust-controls">
                  <button type="button" onClick={() => setFoodCostThreshold(Math.min(100, foodCostThreshold + 1))} aria-label="Increase food cost threshold">+</button>
                  <button type="button" onClick={() => setFoodCostThreshold(Math.max(1, foodCostThreshold - 1))} aria-label="Decrease food cost threshold">-</button>
                </div>
              </div>
              <div className="fc-scale">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          <button
            className="fc-save"
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? 'SAVING…' : 'SAVE CONFIGURATION'}
          </button>
        </div>

        <div className="fc-card fc-right">
          <div className="fc-title-row">
            <h2 className="fc-title">Stock Level Thresholds</h2>
            <Tippy
              content={(
                <div className="fc-tooltip-content fc-threshold-tooltip">
                  <section>
                    <strong>Current Stock Level Status (real time)</strong>
                    <p>Stock % = current stock ÷ ideal stock level × 100.</p>
                    <p>Out of Stock: stock is 0. Low Stock: below the low threshold. Normal Stock: from the low threshold up to the Excess %. Excess Stock: above the Excess % (default 100%).</p>
                    <p>Wet raw materials spoil in 1–2 days, so they need a higher low threshold (default 50%) than dry raw materials (default 20%).</p>
                  </section>
                  <section>
                    <strong>Predicted Stock Level Status (after each forecast)</strong>
                    <p>Coverage % = current stock ÷ forecasted demand × 100.</p>
                    <p>Critical Shortage → Order now. Insufficient Supply → Order soon. Sufficient Supply → No action needed. Above Forecast Limit → Delay restocking.</p>
                    <p><strong>Defaults:</strong> Critical below 50%, Sufficient from 100%, Above Forecast Limit above 200%.</p>
                  </section>
                </div>
              )}
              placement="bottom-end"
              animation="scale"
              duration={200}
              theme="dark"
              arrow={true}
              delay={[100, 0]}
              maxWidth={460}
              zIndex={99999}
              appendTo={() => document.body}
              interactive={true}
              trigger="mouseenter focus click"
            >
              <button type="button" className="fc-info-button" aria-label="Explain stock level thresholds">
                <FiInfo aria-hidden="true" />
              </button>
            </Tippy>
          </div>
          {/* Oct 25 2026: one row per status, the editable % on the status it
              sets. Same rules as backend/utils/stockStatus.js. */}
          <div className="fc-desc-card">
            <strong>Current Stock Level Status</strong> (Ingredient Management): stock on hand ÷ the ingredient&apos;s Ideal Stock Level × 100.
          </div>
          <table className="fc-status-table">
            <thead><tr><th>Status</th><th>When</th><th>Setting</th></tr></thead>
            <tbody>
              <tr>
                <td><i className="fc-status-dot critical"></i>{STATUS_LABELS.out}</td>
                <td>Stock is 0</td>
                <td className="fc-status-fixed">Fixed</td>
              </tr>
              <tr>
                <td><i className="fc-status-dot low"></i>{STATUS_LABELS.low}</td>
                <td>Below {thresholds.current_low_wet_pct}% (wet) or {thresholds.current_low_dry_pct}% (dry)</td>
                <td>
                  <span className="fc-status-inputs">
                    {pctInput('current_low_wet_pct', 'Wet', 'Low Stock threshold for wet raw materials (1–2 days shelf life)')}
                    {pctInput('current_low_dry_pct', 'Dry', 'Low Stock threshold for dry raw materials (1–4 weeks shelf life)')}
                  </span>
                </td>
              </tr>
              <tr>
                <td><i className="fc-status-dot normal"></i>{STATUS_LABELS.normal}</td>
                <td>From the Low Stock % up to {thresholds.current_excess_pct}%</td>
                <td className="fc-status-fixed">Set by Low and Excess</td>
              </tr>
              <tr>
                <td><i className="fc-status-dot excess"></i>{STATUS_LABELS.excess}</td>
                <td>Above {thresholds.current_excess_pct}%</td>
                <td>{pctInput('current_excess_pct', 'Above', 'Excess Stock starts above this % of the ideal stock level')}</td>
              </tr>
            </tbody>
          </table>
          {!excessSaved && (
            <p className="fc-subtitle" role="status">The Excess Stock % stays at 100% until migration 022 is run in Supabase.</p>
          )}

          <div className="fc-desc-card" style={{ marginTop: 14 }}>
            <strong>Forecast (Predicted) Stock Level Status</strong> (Ingredient Demand): stock on hand ÷ forecasted need (safety buffer included) × 100.
          </div>
          <table className="fc-status-table">
            <thead><tr><th>Status</th><th>When</th><th>Setting</th></tr></thead>
            <tbody>
              <tr>
                <td><i className="fc-status-dot critical"></i>{PREDICTED_LABELS.critical}</td>
                <td>Below {thresholds.predicted_critical_pct}% · Order now</td>
                <td>{pctInput('predicted_critical_pct', 'Below', 'Critical Shortage below this % of the forecasted need')}</td>
              </tr>
              <tr>
                <td><i className="fc-status-dot low"></i>{PREDICTED_LABELS.insufficient}</td>
                <td>{thresholds.predicted_critical_pct}% to below {thresholds.predicted_sufficient_pct}% · Order soon</td>
                <td className="fc-status-fixed">Set by the rows above and below</td>
              </tr>
              <tr>
                <td><i className="fc-status-dot normal"></i>{PREDICTED_LABELS.sufficient}</td>
                <td>{thresholds.predicted_sufficient_pct}% to {thresholds.predicted_above_pct}% · No action needed</td>
                <td>{pctInput('predicted_sufficient_pct', 'From', 'Sufficient Supply from this % of the forecasted need')}</td>
              </tr>
              <tr>
                <td><i className="fc-status-dot excess"></i>{PREDICTED_LABELS.above}</td>
                <td>Above {thresholds.predicted_above_pct}% · Delay restocking</td>
                <td>{pctInput('predicted_above_pct', 'Above', 'Above Forecast Limit above this % of the forecasted need')}</td>
              </tr>
            </tbody>
          </table>
          {!thresholdsSaved && (
            <p className="fc-subtitle" role="status" style={{ marginTop: 10 }}>
              Showing the default thresholds. They can be saved once the database update (migration 021) has been run.
            </p>
          )}
          <button type="button" className="fc-save" onClick={handleSaveThresholds} disabled={isSavingThresholds}>
            {isSavingThresholds ? 'SAVING…' : 'SAVE CONFIGURATION'}
          </button>
        </div>

        {renderManagementCard('category', 'Category', 'Used for Product Management and  inventory Management ', categoryTab, setCategoryTab, categoryData, 'Category', [['ingredient', 'Ingredient Management'], ['product', 'Product Management']], null)}
        {renderManagementCard('unit', 'Units', 'Use in inventory Management', unitTab, setUnitTab, unitData, 'Unit', [['ingredient', 'Ingredient Management']], 10)}
      </div>
      {managementDialog && (
        <div className="fc-dialog-backdrop" role="presentation" onMouseDown={() => setManagementDialog(null)}>
          <form className="fc-dialog fc-edit-dialog" onSubmit={handleManagementSubmit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="fc-dialog-header">
              <h2>{renderDialogTitle()}</h2>
              <button type="button" className="fc-dialog-close" onClick={() => setManagementDialog(null)} aria-label="Close dialog"><FiX aria-hidden="true" /></button>
            </div>
            <p className="fc-dialog-context">Used in <strong>{renderDialogContext()}</strong></p>
            <label className="fc-dialog-label">
              {managementDialog.type === 'category' ? 'Category name' : 'Unit name'}
              <input
                className="fc-dialog-input"
                autoFocus
                value={managementValue}
                onChange={(event) => setManagementValue(event.target.value)}
                placeholder={managementDialog.type === 'category' ? 'e.g. Vegetables' : 'e.g. Kilograms (kg)'}
              />
            </label>
            {managementDialog.type === 'unit' && managementDialog.mode === 'new' && (
              <>
                <label className="fc-dialog-label" style={{ marginTop: 12 }}>
                  Type of unit
                  <select
                    className="fc-dialog-input"
                    value={unitForm.family}
                    onChange={(event) => setUnitForm({ ...unitForm, family: event.target.value })}
                  >
                    <option value="">Choose…</option>
                    <option value="mass">Weight (g, kg)</option>
                    <option value="volume">Volume (mL, L, tbsp, tsp)</option>
                    <option value="count">Count (pcs)</option>
                  </select>
                </label>
                {(unitForm.family === 'mass' || unitForm.family === 'volume') && (
                  <label className="fc-dialog-label" style={{ marginTop: 12 }}>
                    {unitForm.family === 'mass'
                      ? `Grams in 1 ${managementValue.trim() || 'unit'}`
                      : `Milliliters (mL) in 1 ${managementValue.trim() || 'unit'}`}
                    <input
                      className="fc-dialog-input"
                      type="number"
                      min="0"
                      step="any"
                      value={unitForm.baseFactor}
                      onChange={(event) => setUnitForm({ ...unitForm, baseFactor: event.target.value })}
                      placeholder={unitForm.family === 'mass' ? 'e.g. 1000 for a kilogram' : 'e.g. 1000 for a liter'}
                    />
                  </label>
                )}
                {unitForm.family === 'count' && (
                  <>
                    <label className="fc-dialog-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                      <input
                        type="checkbox"
                        checked={unitForm.isPiece}
                        onChange={(event) => setUnitForm({ ...unitForm, isPiece: event.target.checked, pieceWeight: '' })}
                      />
                      Single pieces (slices, cloves, sticks) that can be weighed
                    </label>
                    {unitForm.isPiece && (
                      <label className="fc-dialog-label" style={{ marginTop: 12 }}>
                        Grams per piece (optional)
                        <input
                          className="fc-dialog-input"
                          type="number"
                          min="0"
                          step="any"
                          value={unitForm.pieceWeight}
                          onChange={(event) => setUnitForm({ ...unitForm, pieceWeight: event.target.value })}
                          placeholder="Leave blank to estimate by ingredient name"
                        />
                      </label>
                    )}
                  </>
                )}
                <label className="fc-dialog-label" style={{ marginTop: 12 }}>
                  Other names (optional, comma-separated)
                  <input
                    className="fc-dialog-input"
                    value={unitForm.aliases}
                    onChange={(event) => setUnitForm({ ...unitForm, aliases: event.target.value })}
                    placeholder="e.g. kg, kilo, kilos"
                  />
                </label>
              </>
            )}
            <div className="fc-dialog-actions">
              <button type="button" className="fc-dialog-cancel" onClick={() => setManagementDialog(null)}>Cancel</button>
              <button type="submit" className="fc-dialog-submit">{managementDialog.mode === 'new' ? 'Add' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}

      {deleteDialog && (
        <div className="fc-dialog-backdrop" role="presentation" onMouseDown={() => { if (!isDeleting) setDeleteDialog(null); }}>
          <div className="fc-dialog fc-delete-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="fc-dialog-icon warning"><FiTrash aria-hidden="true" /></div>
            <h2>Delete {NAME_LABELS[deleteDialog.type]}?</h2>
            <p>
              You are about to delete <strong>"{deleteDialog.item.name || deleteDialog.item}"</strong>.
              {deleteDialog.type === 'unit'
                ? 'A unit that ingredients or recipes still use cannot be deleted.'
                : 'Items that still use it will be updated automatically.'}
            </p>
            <div className="fc-dialog-actions">
              <button type="button" className="fc-dialog-cancel" onClick={() => setDeleteDialog(null)} disabled={isDeleting}>Cancel</button>
              <button type="button" className="fc-dialog-delete" onClick={handleManagementDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : <><FiTrash aria-hidden="true" /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default ForecastConfig;