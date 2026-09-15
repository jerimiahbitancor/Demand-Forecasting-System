// frontend/src/features/settings/components/BusinessProfile.jsx
import { useState, useEffect, useRef } from "react";
import { FiUploadCloud, FiSave, FiEdit, FiX } from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./BusinessProfile.css";
import { authService } from '../../../services/authService';
import { publishBusinessProfile } from '../../../context/BusinessProfileContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// 0=Monday..6=Sunday — matches date.weekday() in ml-service/services
// forecast_service.py, so nothing needs translating between what's
// stored here and what the forecast pipeline checks.
const OPERATING_DAY_OPTIONS = [
  { value: 0, label: 'Mon' },
  { value: 1, label: 'Tue' },
  { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' },
  { value: 4, label: 'Fri' },
  { value: 5, label: 'Sat' },
  { value: 6, label: 'Sun' },
];
const DEFAULT_OPERATING_DAYS = [0, 1, 2, 3, 4];

function BusinessProfile() {
  const [formData, setFormData] = useState({
    business_name: "",
    business_address: "",
    business_email: "",
    business_contact_number: "",
    logo: null,
    operating_days: DEFAULT_OPERATING_DAYS,
    opens_at: "",
    closes_at: "",
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  const apiClient = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
  });

  apiClient.interceptors.request.use(
    async (config) => {
      try {
        const headers = await authService.getAuthHeaders();
        if (headers && typeof headers === 'object') {
          Object.assign(config.headers, headers);
        }
      } catch (e) {
        // swallow - request will still go through without auth header
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  const fetchBusinessProfile = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.get('/settings/business-profile');
      if (response.data.success && response.data.data) {
        const profile = response.data.data;
        setFormData({
          ...profile,
          operating_days: Array.isArray(profile.operating_days) && profile.operating_days.length > 0
            ? profile.operating_days
            : DEFAULT_OPERATING_DAYS,
          // Postgres `time` comes back as 'HH:MM:SS' — <input type="time"> wants 'HH:MM'.
          opens_at: (profile.opens_at || "").slice(0, 5),
          closes_at: (profile.closes_at || "").slice(0, 5),
        });
        if (profile.logo) {
          setLogoPreview(profile.logo);
        }
      }
    } catch (error) {
      console.error('Error fetching business profile:', error);
      toast.error('Failed to load business profile');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinessProfile();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toggleOperatingDay = (dayValue) => {
    setFormData((prev) => {
      const current = prev.operating_days || [];
      const next = current.includes(dayValue)
        ? current.filter((d) => d !== dayValue)
        : [...current, dayValue].sort((a, b) => a - b);
      return { ...prev, operating_days: next };
    });
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetLogoFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) validateAndSetLogoFile(file);
    e.target.value = '';
  };

  const validateAndSetLogoFile = (file) => {
    const validTypes = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(png|jpg|jpeg|gif|svg)$/i)) {
      toast.error("Please upload a PNG, JPG, JPEG, GIF, or SVG image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5MB limit");
      return;
    }

    setLogoFile(file);

    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    setLogoFile(null);
    setLogoPreview(null);
    setFormData((prev) => ({ ...prev, logo: null }));
  };

  const handleSaveChanges = async () => {
    if (!formData.business_name || !formData.business_address) {
      toast.error('Business name and address are required');
      return;
    }

    if (!formData.operating_days || formData.operating_days.length === 0) {
      toast.error('Select at least one operating day');
      return;
    }

    setIsSaving(true);
    const savingToast = toast.loading('Saving business profile...');

    try {
      let profileToSave = formData;

      if (logoFile) {
        setIsUploadingLogo(true);
        const form = new FormData();
        form.append('logo', logoFile);

        const authHeaders = await authService.getAuthHeaders();
        const logoResponse = await axios.post(
          `${API_URL}/settings/business-profile/logo`,
          form,
          { headers: { ...authHeaders } }
        );

        if (!logoResponse.data.success || !logoResponse.data.url) {
          throw new Error(logoResponse.data.error || 'Failed to upload logo');
        }

        profileToSave = { ...formData, logo: logoResponse.data.url };
      }

      const response = await apiClient.post('/settings/business-profile', profileToSave);

      toast.dismiss(savingToast);
      if (response.data.success) {
        setFormData(response.data.data || profileToSave);
        setLogoFile(null);
        publishBusinessProfile(response.data.data || profileToSave);
        toast.success('Business profile saved successfully!');
      } else {
        toast.error('Failed to save business profile');
      }
    } catch (error) {
      toast.dismiss(savingToast);
      console.error('Error saving business profile:', error);
      toast.error(error.response?.data?.error || error.message || 'Failed to save business profile');
    } finally {
      setIsSaving(false);
      setIsUploadingLogo(false);
    }
  };

  return (
    <div className="business-profile-container">
      <div className="content-wrapper">
        <div className="form-section">
          <div className="form-group">
            <label htmlFor="businessName" className="form-label">
              Business Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="businessName"
              name="business_name"
              className="form-input"
              placeholder="Enter business name"
              value={formData.business_name}
              onChange={handleInputChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="businessAddress" className="form-label">
              Business Address <span className="required">*</span>
            </label>
            <input
              type="text"
              id="businessAddress"
              name="business_address"
              className="form-input"
              placeholder="Enter business address"
              value={formData.business_address}
              onChange={handleInputChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="businessEmail" className="form-label">
              Business Email
            </label>
            <input
              type="email"
              id="businessEmail"
              name="business_email"
              className="form-input"
              placeholder="Enter business email"
              value={formData.business_email}
              onChange={handleInputChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="businessContactNumber" className="form-label">
              Business Contact Number
            </label>
            <input
              type="tel"
              id="businessContactNumber"
              name="business_contact_number"
              className="form-input"
              placeholder="Enter contact number"
              value={formData.business_contact_number}
              onChange={handleInputChange}
            />
          </div>
        </div>

        <div className="upload-section">
          <div className="upload-header">
            <h3 className="upload-title">Business Logo</h3>
            <p className="upload-subtitle">Upload your business logo (PNG, JPG, GIF, SVG - Max 5MB)</p>
          </div>

          {/* Logo Preview */}
          {logoPreview && (
            <div className="logo-preview-container">
              <div className="logo-preview-wrapper">
                <img src={logoPreview} alt="Business Logo" className="logo-preview-image" />
                <button 
                  className="logo-remove-btn" 
                  onClick={handleRemoveFile} 
                  disabled={isUploadingLogo}
                  title="Remove logo"
                >
                  <FiX size={16} />
                </button>
              </div>
              <button 
                className="logo-change-btn" 
                onClick={() => logoInputRef.current?.click()}
                disabled={isUploadingLogo}
              >
                <FiEdit size={14} /> Change Logo
              </button>
            </div>
          )}

          {/* Drop Zone */}
          {!logoPreview && (
            <div
              className={`drop-zone ${isDragging ? "dragging" : ""}`}
              onDrop={handleFileDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !isUploadingLogo && logoInputRef.current?.click()}
            >
              <div className="drop-zone-icon">
                <FiUploadCloud size={28} />
              </div>
              {isUploadingLogo ? (
                <div className="uploading-status">
                  <div className="spinner"></div>
                  <p className="drop-zone-text">Uploading logo...</p>
                </div>
              ) : (
                <>
                  <p className="drop-zone-text">
                    Drag & drop your logo here or <span className="browse-link">browse</span>
                  </p>
                  <p className="drop-zone-hint">Supports PNG, JPG, GIF, SVG up to 5MB</p>
                </>
              )}
            </div>
          )}

          <input
            ref={logoInputRef}
            type="file"
            id="logoFileInput"
            className="file-input"
            accept=".png,.jpg,.jpeg,.gif,.svg"
            onChange={handleFileSelect}
            disabled={isUploadingLogo}
          />
        </div>

        <div className="schedule-section">
          <div className="upload-header">
            <h3 className="upload-title">Operating Schedule</h3>
            <p className="upload-subtitle">
              Used by the forecasting pipeline to know which future dates to forecast for versus
              treat as closed — a schedule change here takes effect on the next forecast run.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Operating Days</label>
            <div className="day-toggle-group">
              {OPERATING_DAY_OPTIONS.map((day) => {
                const isActive = (formData.operating_days || []).includes(day.value);
                return (
                  <button
                    type="button"
                    key={day.value}
                    className={`day-toggle-btn ${isActive ? 'active' : ''}`}
                    onClick={() => toggleOperatingDay(day.value)}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="schedule-time-row">
            <div className="form-group">
              <label htmlFor="opensAt" className="form-label">
                Opens At
              </label>
              <input
                type="time"
                id="opensAt"
                name="opens_at"
                className="form-input"
                value={formData.opens_at}
                onChange={handleInputChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="closesAt" className="form-label">
                Closes At
              </label>
              <input
                type="time"
                id="closesAt"
                name="closes_at"
                className="form-input"
                value={formData.closes_at}
                onChange={handleInputChange}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="button-section">
        <button
          className="btn-save-changes"
          onClick={handleSaveChanges}
          disabled={isSaving || isLoading || isUploadingLogo}
        >
          <FiSave size={16} />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

export default BusinessProfile;