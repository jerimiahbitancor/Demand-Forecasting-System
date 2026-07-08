// BusinessProfile.jsx
import { useState, useEffect } from "react";
import { FiUploadCloud, FiCheckCircle, FiSave, FiEdit } from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./BusinessProfile.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function BusinessProfile() {
  const [formData, setFormData] = useState({
    businessName: "",
    businessAddress: "",
    businessEmail: "",
    businessContactNumber: "",
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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

  // Fetch business profile
  const fetchBusinessProfile = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.get('/settings/business-profile');
      if (response.data.success) {
        setFormData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching business profile:', error);
      // If no profile exists, use default/empty
      toast.error('Failed to load business profile');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinessProfile();
  }, []);

  // Form input handler
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Upload handlers
  const handleFileDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      validateAndSetLogoFile(file);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      validateAndSetLogoFile(file);
    }
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
    reader.onload = (e) => {
      setLogoPreview(e.target.result);
    };
    reader.readAsDataURL(file);
    toast.success('Logo uploaded successfully');
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
  };

  // Save changes handler
  const handleSaveChanges = async () => {
    // Validate required fields
    if (!formData.businessName || !formData.businessAddress) {
      toast.error('Business name and address are required');
      return;
    }

    setIsSaving(true);
    const savingToast = toast.loading('Saving business profile...');

    try {
      const payload = { ...formData };
      
      // If logo file exists, convert to base64 or upload
      if (logoFile) {
        // In production, upload to server
        // const reader = new FileReader();
        // const base64 = await new Promise((resolve) => {
        //   reader.onload = (e) => resolve(e.target.result);
        //   reader.readAsDataURL(logoFile);
        // });
        // payload.logo = base64;
        payload.logo = logoPreview;
      }

      const response = await apiClient.post('/settings/business-profile', payload);
      
      toast.dismiss(savingToast);
      if (response.data.success) {
        toast.success('✅ Business profile saved successfully!');
      } else {
        toast.error('Failed to save business profile');
      }
    } catch (error) {
      toast.dismiss(savingToast);
      console.error('Error saving business profile:', error);
      toast.error(error.response?.data?.error || 'Failed to save business profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="business-profile-container">
      <div className="content-wrapper">
        {/* Form Section */}
        <div className="form-section">
          <div className="form-group">
            <label htmlFor="businessName" className="form-label">
              Business Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="businessName"
              name="businessName"
              className="form-input"
              placeholder="Enter business name"
              value={formData.businessName}
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
              name="businessAddress"
              className="form-input"
              placeholder="Enter business address"
              value={formData.businessAddress}
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
              name="businessEmail"
              className="form-input"
              placeholder="Enter business email"
              value={formData.businessEmail}
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
              name="businessContactNumber"
              className="form-input"
              placeholder="Enter contact number"
              value={formData.businessContactNumber}
              onChange={handleInputChange}
            />
          </div>
        </div>

        {/* Upload Logo Section */}
        <div className="upload-section">
          <div className="upload-header">
            <h3 className="upload-title">Upload Business Logo</h3>
          </div>

          {/* Current Logo Preview */}
          {logoPreview && (
            <div className="logo-preview">
              <img src={logoPreview} alt="Business Logo" className="logo-image" />
              <button className="remove-logo-btn" onClick={handleRemoveFile}>
                <FiEdit size={16} /> Change
              </button>
            </div>
          )}

          {/* Drag and Drop Zone */}
          <div
            className={`drop-zone ${isDragging ? "dragging" : ""} ${logoFile ? "uploaded" : ""}`}
            onDrop={handleFileDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById("logoFileInput").click()}
          >
            <div className="drop-zone-icon">
              <FiUploadCloud size={32} />
            </div>
            {logoFile ? (
              <div className="uploaded-file-info">
                <p className="file-name">{logoFile.name}</p>
                <p className="file-size">
                  {(logoFile.size / 1024).toFixed(2)} KB
                </p>
                <button
                  className="remove-file"
                  onClick={handleRemoveFile}
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <p className="drop-zone-text">
                  Drag and Drop Files or{" "}
                  <span className="browse-link">Browse</span>
                </p>
                <p className="upload-subtitle">
                  Supported formats: PNG, JPG, GIF, SVG (Max 5MB)
                </p>
              </>
            )}
            <input
              type="file"
              id="logoFileInput"
              className="file-input"
              accept=".png,.jpg,.jpeg,.gif,.svg"
              onChange={handleFileSelect}
            />
          </div>
        </div>
      </div>

      {/* Save Changes Button */}
      <div className="button-section">
        <button 
          className="btn-save-changes" 
          onClick={handleSaveChanges}
          disabled={isSaving || isLoading}
        >
          <FiSave size={16} /> 
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

export default BusinessProfile;