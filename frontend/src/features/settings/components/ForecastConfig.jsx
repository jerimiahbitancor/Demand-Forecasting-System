// ForecastConfig.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import './ForecastConfig.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function ForecastConfig() {
  const [value, setValue] = useState(15);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    fetchConfig();
  }, []);

  // Save configuration
  const handleSaveConfig = async () => {
    setIsSaving(true);
    const savingToast = toast.loading('Saving configuration...');

    try {
      const response = await apiClient.post('/settings/forecast-config', {
        safety_buffer: value
      });

      toast.dismiss(savingToast);
      if (response.data.success) {
        toast.success('Configuration saved successfully!');
      } else {
        toast.error('Failed to save configuration');
      }
    } catch (error) {
      toast.dismiss(savingToast);
      console.error('Error saving config:', error);
      toast.error(error.response?.data?.error || 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="fc-root">
      <div className="fc-inner">
        <div className="fc-card fc-left">
          <h2 className="fc-title">Safety Buffer Percentage</h2>
          <div className="fc-desc-card">
            <strong>Description:</strong> Additional allowance for forecasted ingredient demand.
          </div>

          <div className="fc-control-card">
            <div className="fc-slider-row">
              <div className="fc-percent">[{value}%]</div>
              <input
                className="fc-slider"
                type="range"
                min="0"
                max="50"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                disabled={isSaving || loading}
              />
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
            disabled={isSaving || loading}
          >
            {isSaving ? 'SAVING...' : 'SAVE CONFIGURATION'}
          </button>
        </div>

        <aside className="fc-card fc-right">
          <h3 className="fc-right-title">This safety buffer covers:</h3>
          <ul className="fc-bullets">
            <li>Unexpected customer demand (walk-ins, spikes)</li>
            <li>Staff meals not recorded in your POS system</li>
            <li>Seasonal variations in demand</li>
          </ul>

          <p className="fc-note"><strong>Higher buffer</strong> = Less risk of stockout, more potential waste</p>
          <p className="fc-note"><strong>Lower buffer</strong> = Less waste, higher risk of stockout</p>

          <p className="fc-meta"><strong>Current:</strong> {value}%</p>
          <p className="fc-meta"><strong>Recommended:</strong> 10–20%</p>
          {loading && <p className="fc-meta loading-text">Loading configuration...</p>}
        </aside>
      </div>
    </section>
  );
}

export default ForecastConfig;