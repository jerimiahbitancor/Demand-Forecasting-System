// ForecastConfig.jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import { FiEdit2, FiInfo, FiPlus } from 'react-icons/fi';
import './ForecastConfig.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function ForecastConfig() {
  const [value, setValue] = useState(15);
  const [thresholds, setThresholds] = useState({ critical: 50, low: 100, excess: 200 });
  const [categoryTab, setCategoryTab] = useState('ingredient');
  const [unitTab, setUnitTab] = useState('ingredient');
  const [categoryData, setCategoryData] = useState({ ingredient: ['Meat', 'Fruits'], product: ['Silog', 'Pancit', 'Drinks'] });
  const [unitData, setUnitData] = useState({ ingredient: ['kg', 'g', 'ml'], product: ['servings', 'g', 'ml'] });
  const [managementDialog, setManagementDialog] = useState(null);
  const [managementValue, setManagementValue] = useState('');
  const [loading, setLoading] = useState(false);

  // Get auth token
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // Axios instance
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Fetch configuration
  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/settings/forecast-config');
      if (response.data.success) {
        setValue(response.data.data.safety_buffer || 15);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      // Use default if API fails
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(fetchConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveConfig = () => {
    toast('This feature is not yet implemented.');
  };

  const handleSaveThresholds = () => {
    toast('This feature is not yet implemented.');
  };

  const openManagementDialog = (type, mode, item = '') => {
    const activeTab = type === 'category' ? categoryTab : unitTab;
    setManagementDialog({ type, mode, activeTab, originalValue: item });
    setManagementValue(item);
  };

  const handleManagementSubmit = (event) => {
    event.preventDefault();
    const nextValue = managementValue.trim();
    if (!nextValue) return;
    const isCategory = managementDialog.type === 'category';
    const activeTab = managementDialog.activeTab;
    const setData = isCategory ? setCategoryData : setUnitData;
    setData((currentData) => ({
      ...currentData,
      [activeTab]: managementDialog.mode === 'new'
        ? [...currentData[activeTab], nextValue]
        : currentData[activeTab].map((item) => item === managementDialog.originalValue ? nextValue : item)
    }));
    setManagementDialog(null);
    toast.success(`${managementDialog.mode === 'new' ? 'Added' : 'Updated'} ${isCategory ? 'category' : 'unit'}.`);
  };

  const renderManagementCard = (type, title, subtitle, activeTab, setActiveTab, data, columnLabel) => (
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
      <div className="fc-management-tabs" role="tablist">
        {[
          ['ingredient', 'Ingredient Management'],
          ['product', 'Product Management']
        ].map(([tab, label]) => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {label}
          </button>
        ))}
      </div>
      <div className="fc-management-table-wrap">
        <table className="fc-management-table">
          <thead><tr><th>{columnLabel}</th><th>Actions</th></tr></thead>
          <tbody>
            {data[activeTab].map((item) => (
              <tr key={item}>
                <td>{item}</td>
                <td><button type="button" className="fc-edit-button" aria-label={`Edit ${item}`} onClick={() => openManagementDialog(type, 'edit', item)}><FiEdit2 aria-hidden="true" /></button></td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 4 - data[activeTab].length) }).map((_, index) => <tr className="fc-empty-row" key={`empty-${index}`}><td></td><td></td></tr>)}
          </tbody>
        </table>
      </div>
    </article>
  );

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
                <input className="fc-slider" type="range" min="0" max="50" value={value} onChange={(e) => setValue(Number(e.target.value))} disabled={loading} />
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
            disabled={loading}
          >
            SAVE CONFIGURATION
          </button>
        </div>

        <div className="fc-card fc-right">
          <div className="fc-title-row">
            <h2 className="fc-title">Stock Level Thresholds</h2>
            <Tippy
              content={(
                <div className="fc-tooltip-content fc-threshold-tooltip">
                   <section>
                    <strong>Low Threshold</strong>
                    <p>Stock is insufficient to cover tomorrow's demand. Proactive alert — order soon before you run out during the day.</p>
                    <p><strong>Higher value (e.g., 120%):</strong> Earlier alerts, more restock time<br /><strong>Lower value (e.g., 80%):</strong> Fewer alerts, higher stockout risk</p>
                    <p><strong>Default:</strong> 100%<br /><strong>Recommended:</strong> 90–110%</p>
                  </section>
                  <section>
                    <strong>Critical Threshold</strong>
                    <p>Stock is severely insufficient — cannot even cover half of tomorrow's demand. Emergency — you will run out soon.</p>
                    <p><strong>Higher value (e.g., 60%):</strong> Safer, more alerts<br /><strong>Lower value (e.g., 40%):</strong> Fewer alerts, higher stockout risk</p>
                    <p><strong>Default:</strong> 50%<br /><strong>Recommended:</strong> 40–60%</p>
                  </section>
                  <section>
                    <strong>Excess Threshold</strong>
                    <p>Stock is more than double tomorrow's demand — you may have over-purchased. Consider delaying restocking to avoid waste and excess inventory costs.</p>
                    <p><strong>Higher value (e.g., 250%):</strong> Accept higher inventory levels<br /><strong>Lower value (e.g., 150%):</strong> Tighter control, earlier alerts</p>
                    <p><strong>Default:</strong> 200%<br /><strong>Recommended:</strong> 150–250%</p>
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
          <div className="fc-desc-card"><strong>Description:</strong> These thresholds determine stock status by comparing current stock against tomorrow's forecasted demand.</div>
          <div className="fc-threshold-list">
            {[
              ['critical', 'Critical Threshold:', 'Stock < 50% of demand', 'Critical (Order now)'],
              ['low', 'Low Threshold:', 'Stock < 100% of demand', 'Low (Order soon)'],
              ['excess', 'Excess Threshold:', 'Stock > 200% of demand', 'Excess (Delay restocking)']
            ].map(([key, label, description, status]) => (
              <label className="fc-threshold-row" key={key}>
                <input type="number" value={thresholds[key]} onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })} />
                <span><strong>{label}</strong><small>{description} <i className={`fc-status-dot ${key}`}></i>{status}</small></span>
              </label>
            ))}
          </div>
          <button type="button" className="fc-save" onClick={handleSaveThresholds}>SAVE CONFIGURATION</button>
        </div>

        {renderManagementCard('category', 'Category', 'Used for Product Management', categoryTab, setCategoryTab, categoryData, 'Category')}
        {renderManagementCard('unit', 'Units', 'Use in inventory Management', unitTab, setUnitTab, unitData, 'Unit')}
      </div>
      {managementDialog && (
        <div className="fc-dialog-backdrop" role="presentation" onMouseDown={() => setManagementDialog(null)}>
          <form className="fc-dialog" onSubmit={handleManagementSubmit} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{managementDialog.mode === 'new' ? `Add ${managementDialog.type === 'category' ? 'Category' : 'Unit'} – ${managementDialog.activeTab === 'ingredient' ? 'Ingredient Management' : 'Product Management'}` : `Edit ${managementDialog.type === 'category' ? 'Category' : 'Unit'} – ${managementDialog.activeTab === 'ingredient' ? 'Ingredient Management' : 'Product Management'}`}</h2>
            <label>{managementDialog.type === 'category' ? 'Category name' : 'Unit name'}<input autoFocus value={managementValue} onChange={(event) => setManagementValue(event.target.value)} /></label>
            <div className="fc-dialog-actions"><button type="button" onClick={() => setManagementDialog(null)}>Cancel</button><button type="submit" className="fc-dialog-submit">Save</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

export default ForecastConfig;