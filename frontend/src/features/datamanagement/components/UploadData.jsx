// components/UploadData.jsx
import { useState } from "react";
import {
  FiUploadCloud,
  FiAlertCircle,
  FiCheckCircle,
  FiXCircle,
} from "react-icons/fi";
import HistoricalData from "./HistoricalData";
import MappingData from "./MappingData";
import axios from 'axios';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { useAuth } from "../../../context/AuthContext";

const UploadData = ({
  activeTab,
  setActiveTab,
  tabs,
  apiUrl,
  onUploadSuccess,
  handleConfirmUpload
}) => {
  // Sales upload state
  const [salesFile, setSalesFile] = useState(null);
  const [isSalesDragging, setIsSalesDragging] = useState(false);
  const [salesUploadStatus, setSalesUploadStatus] = useState(null);
  const [salesProgress, setSalesProgress] = useState(0);
  const [salesValidated, setSalesValidated] = useState(false);
  const [salesValidationErrors, setSalesValidationErrors] = useState([]);
  const [salesIsValid, setIsSalesValid] = useState(false);

  // Menu upload state
  const [menuFile, setMenuFile] = useState(null);
  const [isMenuDragging, setIsMenuDragging] = useState(false);
  const [menuUploadStatus, setMenuUploadStatus] = useState(null);
  const [menuProgress, setMenuProgress] = useState(0);
  const [menuValidated, setMenuValidated] = useState(false);
  const [menuValidationErrors, setMenuValidationErrors] = useState([]);
  const [menuDbDuplicates, setMenuDbDuplicates] = useState([]);
  const [menuIsValid, setMenuIsValid] = useState(false);

  // Dynamic preview data from API
  const [salesPreviewData, setSalesPreviewData] = useState({
    totalRecords: 0,
    validRecords: 0,
    invalidRecords: 0,
    systemMatch: "0%",
    issues: []
  });

  const [menuPreviewData, setMenuPreviewData] = useState({
    totalItems: 0,
    mappedItems: 0,
    unmappedItems: 0,
    issues: []
  });

  // Toast container refs
  const [salesToastId, setSalesToastId] = useState(null);
  const [menuToastId, setMenuToastId] = useState(null);

  // Get auth token from sessionStorage
  const getAuthToken = () => {
    const token = sessionStorage.getItem('token') || 
                  sessionStorage.getItem('access_token');
    
    if (!token) {
      console.log('sessionStorage keys:', Object.keys(sessionStorage));
    }
    
    return token;
  };

  // Create axios instance with interceptor (only once)
  const apiClient = axios.create({
    baseURL: apiUrl || 'http://localhost:5000/api',
    headers: {
      'Content-Type': 'application/json',
    }
  });

  // Add token to every request from sessionStorage
  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('Token added to request:', config.url);
      } else {
        console.warn('No token found in sessionStorage for request:', config.url);
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Function to read file client-side
  const readFileData = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          let data = [];
          const fileExtension = file.name.split('.').pop().toLowerCase();
          
          if (fileExtension === 'csv') {
            const text = e.target.result;
            const lines = text.split('\n');
            const headers = lines[0].split(',').map(h => h.trim());
            
            for (let i = 1; i < lines.length; i++) {
              if (lines[i].trim()) {
                const values = lines[i].split(',').map(v => v.trim());
                const row = {};
                headers.forEach((header, index) => {
                  row[header] = values[index] || '';
                });
                data.push(row);
              }
            }
          } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            data = XLSX.utils.sheet_to_json(firstSheet);
          }
          
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      
      reader.onerror = reject;
      
      if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  // Normalize column name for flexible matching
  const normalizeColumnName = (name) => {
    if (!name) return '';
    let normalized = name.toString().trim().replace(/\s+/g, ' ');
    
    const mappings = {
      'item name': 'Item name',
      'category': 'Category',
      'items sold': 'Items sold',
      'gross sales': 'Gross sales',
      'items refunded': 'Items refunded',
      'refunds': 'Refunds',
      'net sales': 'Net sales'
    };
    
    const lowerKey = normalized.toLowerCase();
    return mappings[lowerKey] || normalized;
  };

  // Validate sales data - UPDATED with new columns
  const validateSalesData = (data) => {
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;
    
    if (data.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [{ row: 0, message: 'File is empty' }],
        isValid: false
      };
    }

    // Updated required columns
    const requiredColumns = ['Item name', 'Category', 'Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Net sales'];
    const headers = Object.keys(data[0]);
    
    console.log('Headers found:', headers);
    console.log('Required columns:', requiredColumns);
    
    const missingColumns = [];
    const columnMap = {};
    
    requiredColumns.forEach(col => {
      let found = headers.some(h => h.trim() === col);
      
      if (!found) {
        found = headers.some(h => h.toLowerCase().trim() === col.toLowerCase().trim());
      }
      
      if (!found) {
        const normalizedCol = normalizeColumnName(col);
        found = headers.some(h => normalizeColumnName(h) === normalizedCol);
      }
      
      if (!found) {
        missingColumns.push(col);
      } else {
        const actualCol = headers.find(h => 
          h.trim() === col || 
          h.toLowerCase().trim() === col.toLowerCase().trim() ||
          normalizeColumnName(h) === normalizeColumnName(col)
        );
        columnMap[col] = actualCol || col;
      }
    });
    
    if (missingColumns.length > 0) {
      errors.push({
        row: 1,
        message: `Missing required columns: ${missingColumns.join(', ')}. Your file has: ${headers.join(', ')}. Required columns: ${requiredColumns.join(', ')}`
      });
      return {
        totalRows: data.length,
        validRows: 0,
        invalidRows: data.length,
        errors: errors,
        isValid: false
      };
    }
    
    data.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowErrors = [];
      
      requiredColumns.forEach(col => {
        const actualCol = columnMap[col];
        if (!actualCol) {
          rowErrors.push(`${col} column not found`);
          return;
        }
        
        const value = row[actualCol];
        
        if (value === undefined || value === null || value === '' || value === ' ') {
          rowErrors.push(`${col} is empty`);
        } else if (['Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Net sales'].includes(col)) {
          const numValue = parseFloat(value);
          if (isNaN(numValue) && value.toString().trim() !== '') {
            rowErrors.push(`${col} must be a valid number`);
          }
        }
      });
      
      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
        invalidCount++;
      } else {
        validCount++;
      }
    });
    
    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10),
      isValid: errors.length === 0
    };
  };

  // Validate menu data
  const validateMenuData = (data) => {
    const errors = [];
    let validCount = 0;
    let invalidCount = 0;
    
    if (data.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [{ row: 0, message: 'File is empty' }],
        isValid: false
      };
    }

    const requiredColumns = ['Product Name', 'Ingredients', 'Quantity', 'Unit', 'Price', 'Category'];
    const headers = Object.keys(data[0]);
    
    const missingColumns = [];
    requiredColumns.forEach(col => {
      const found = headers.some(h => h.toLowerCase() === col.toLowerCase());
      if (!found) {
        missingColumns.push(col);
      }
    });
    
    if (missingColumns.length > 0) {
      errors.push({
        row: 1,
        message: `Missing required columns: ${missingColumns.join(', ')}. Your file has: ${headers.join(', ')}. Required columns: ${requiredColumns.join(', ')}`
      });
      return {
        totalRows: data.length,
        validRows: 0,
        invalidRows: data.length,
        errors: errors,
        isValid: false
      };
    }
    
    data.forEach((row, index) => {
      const rowNumber = index + 2;
      const rowErrors = [];
      
      requiredColumns.forEach(col => {
        const actualCol = headers.find(h => h.toLowerCase() === col.toLowerCase());
        const value = row[actualCol];
        
        if (col === 'Quantity' || col === 'Price') {
          if (value === undefined || value === null || value === '' || value === ' ') {
            rowErrors.push(`${col} is empty`);
          } else if (isNaN(parseFloat(value))) {
            rowErrors.push(`${col} must be a valid number`);
          } else if (parseFloat(value) <= 0) {
            rowErrors.push(`${col} must be greater than 0`);
          }
        } else {
          if (value === undefined || value === null || value === '' || value === ' ') {
            rowErrors.push(`${col} is empty`);
          }
        }
      });
      
      if (rowErrors.length > 0) {
        errors.push({
          row: rowNumber,
          message: rowErrors.join('; ')
        });
        invalidCount++;
      } else {
        validCount++;
      }
    });
    
    return {
      totalRows: data.length,
      validRows: validCount,
      invalidRows: invalidCount,
      errors: errors.slice(0, 10),
      isValid: errors.length === 0
    };
  };

  // Sales handlers
  const handleSalesFileDrop = (e) => {
    e.preventDefault();
    setIsSalesDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      validateAndSetSalesFile(file);
    }
  };

  const handleSalesFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      validateAndSetSalesFile(file);
    }
  };

  const validateAndSetSalesFile = async (file) => {
    const validTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(csv|xlsx)$/i)) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('Please upload a CSV or XLSX file');
      setSalesToastId(id);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('File size exceeds 20MB limit');
      setSalesToastId(id);
      return;
    }

    setSalesFile(file);
    setSalesUploadStatus(null);
    setSalesProgress(0);
    setSalesValidated(false);
    setSalesValidationErrors([]);
    setIsSalesValid(false);
    console.log("Sales file uploaded:", file.name);

    try {
      const data = await readFileData(file);
      const validation = validateSalesData(data);
      
      setSalesPreviewData({
        totalRecords: validation.totalRows,
        validRecords: validation.validRows,
        invalidRecords: validation.invalidRows,
        systemMatch: validation.totalRows > 0 ? 
          `${Math.round((validation.validRows / validation.totalRows) * 100)}%` : '0%',
        issues: validation.errors
      });
      
      setSalesValidated(true);
      setSalesValidationErrors(validation.errors);
      setIsSalesValid(validation.isValid);
      
      if (validation.isValid) {
        if (salesToastId) toast.dismiss(salesToastId);
        const id = toast.success(`File validated: ${validation.validRows} valid records found`);
        setSalesToastId(id);
      } else {
        if (salesToastId) toast.dismiss(salesToastId);
        const id = toast.error(`File has ${validation.invalidRows} issues. Please review the preview below.`);
        setSalesToastId(id);
      }
    } catch (error) {
      console.error('Error reading file:', error);
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('Error reading file. Please make sure it is a valid CSV or Excel file.');
      setSalesToastId(id);
    }
  };

  const handleSalesDragOver = (e) => {
    e.preventDefault();
    setIsSalesDragging(true);
  };

  const handleSalesDragLeave = (e) => {
    e.preventDefault();
    setIsSalesDragging(false);
  };

  const handleSalesConfirm = async () => {
    if (!salesFile) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('Please select a file first');
      setSalesToastId(id);
      return;
    }

    if (!salesValidated) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('Please wait for file validation to complete');
      setSalesToastId(id);
      return;
    }

    if (!salesIsValid) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error(`Cannot upload. Please fix ${salesValidationErrors.length} validation issue(s) first.`);
      setSalesToastId(id);
      return;
    }
    
    try {
      setSalesUploadStatus('loading');
      setSalesProgress(0);
      console.log("Sales upload confirmed");
      
      const progressInterval = setInterval(() => {
        setSalesProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 10;
        });
      }, 300);
      
      const formData = new FormData();
      formData.append('file', salesFile);
      formData.append('fileType', 'sales');

      const token = getAuthToken();
      console.log('Sending sales upload with token:', token ? 'Yes' : 'No');

      const response = await apiClient.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setSalesProgress(percentCompleted);
        }
      });

      clearInterval(progressInterval);
      setSalesProgress(100);

      if (response?.data?.success) {
      setSalesUploadStatus('success');
      
      const summary = response?.data?.summary || {};
      setSalesPreviewData({
        totalRecords: summary.totalRows || 0,
        validRecords: summary.validRows || 0,
        invalidRecords: summary.invalidRows || 0,
        systemMatch: summary.validRows && summary.totalRows ? 
          `${Math.round((summary.validRows / summary.totalRows) * 100)}%` : '0%',
        issues: summary.errors || []
      });
      
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.success(`Sales data uploaded successfully! ${summary.validRows || 0} records processed.`);
      setSalesToastId(id);
      
      // NEW: Re-sync the flag from the DB
      await checkUploadStatus();
      
      if (onUploadSuccess) {
        onUploadSuccess(response.data);
      }
      
      setTimeout(() => {
        setSalesUploadStatus(null);
        setSalesFile(null);
        setSalesProgress(0);
        setSalesValidated(false);
        setSalesValidationErrors([]);
          setIsSalesValid(false);
      }, 3000);
    }
    } catch (error) {
      console.error('Upload error:', error);
      setSalesUploadStatus('error');
      setSalesProgress(0);
      
      // Check for duplicate error
      const errorMsg = error.response?.data?.error || error.message || 'Upload failed';
      
      if (error.response?.status === 409) {
        if (salesToastId) toast.dismiss(salesToastId);
        const id = toast.error(`Upload failed: ${error.response?.data?.message || 'Duplicate file detected'}`);
        setSalesToastId(id);
      } else {
        if (salesToastId) toast.dismiss(salesToastId);
        const id = toast.error(`Upload failed: ${errorMsg}`);
        setSalesToastId(id);
      }
      
      setTimeout(() => {
        setSalesUploadStatus(null);
      }, 3000);
    }
  };

  const handleSalesDiscard = () => {
    setSalesFile(null);
    setSalesUploadStatus(null);
    setSalesProgress(0);
    setSalesValidated(false);
    setSalesValidationErrors([]);
    setIsSalesValid(false);
    setSalesPreviewData({
      totalRecords: 0,
      validRecords: 0,
      invalidRecords: 0,
      systemMatch: "0%",
      issues: []
    });
    if (salesToastId) toast.dismiss(salesToastId);
    const id = toast('File discarded');
    setSalesToastId(id);
    console.log("Sales upload discarded");
  };

  const handleSalesFixIssue = (row) => {
    console.log(`Fixing sales issue at row ${row}`);
    if (salesToastId) toast.dismiss(salesToastId);
    const id = toast(`Fixing issue at row ${row}...`);
    setSalesToastId(id);
  };

  // Menu handlers
  const handleMenuFileDrop = (e) => {
    e.preventDefault();
    setIsMenuDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      validateAndSetMenuFile(file);
    }
  };

  const handleMenuFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      validateAndSetMenuFile(file);
    }
  };

  const validateAndSetMenuFile = async (file) => {
    const validTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(csv|xlsx)$/i)) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('Please upload a CSV or XLSX file');
      setMenuToastId(id);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('File size exceeds 20MB limit');
      setMenuToastId(id);
      return;
    }

    setMenuFile(file);
    setMenuUploadStatus(null);
    setMenuProgress(0);
    setMenuValidated(false);
    setMenuValidationErrors([]);
    setMenuDbDuplicates([]);
    setMenuIsValid(false);
    console.log("Menu file uploaded:", file.name);

    try {
      const data = await readFileData(file);
      const validation = validateMenuData(data);
      
      setMenuPreviewData({
        totalItems: validation.totalRows,
        mappedItems: validation.validRows,
        unmappedItems: validation.invalidRows,
        issues: validation.errors
      });
      
      setMenuValidated(true);
      setMenuValidationErrors(validation.errors);
      setMenuIsValid(validation.isValid);
      
      if (validation.isValid) {
        if (menuToastId) toast.dismiss(menuToastId);
        const id = toast.success(`Menu file validated: ${validation.validRows} items ready`);
        setMenuToastId(id);
      } else {
        if (menuToastId) toast.dismiss(menuToastId);
        const id = toast.error(`Menu file has ${validation.invalidRows} issues. Please review the preview below.`);
        setMenuToastId(id);
      }
    } catch (error) {
      console.error('Error reading file:', error);
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('Error reading file. Please make sure it is a valid CSV or Excel file.');
      setMenuToastId(id);
    }
  };

  const handleMenuDragOver = (e) => {
    e.preventDefault();
    setIsMenuDragging(true);
  };

  const handleMenuDragLeave = (e) => {
    e.preventDefault();
    setIsMenuDragging(false);
  };

  const handleMenuConfirm = async () => {
    if (!menuFile) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('Please select a file first');
      setMenuToastId(id);
      return;
    }

    if (!menuValidated) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('Please wait for file validation to complete');
      setMenuToastId(id);
      return;
    }

    if (!menuIsValid) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error(`Cannot upload. Please fix ${menuValidationErrors.length} validation issue(s) first.`);
      setMenuToastId(id);
      return;
    }
    
    try {
      setMenuUploadStatus('loading');
      setMenuProgress(0);
      console.log("Menu upload confirmed");
      
      const progressInterval = setInterval(() => {
        setMenuProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 10;
        });
      }, 300);
      
      const formData = new FormData();
      formData.append('file', menuFile);
      formData.append('fileType', 'menu');

      const token = getAuthToken();
      console.log('Sending menu upload with token:', token ? 'Yes' : 'No');

      const response = await apiClient.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setMenuProgress(percentCompleted);
        }
      });

      clearInterval(progressInterval);
      setMenuProgress(100);

      if (response?.data?.success) {
        const summary = response?.data?.summary || {};
        
        if (summary.dbDuplicates && summary.dbDuplicates.length > 0) {
          setMenuValidated(false);
          setMenuValidationErrors(summary.dbDuplicates.map(d => ({
            row: 0,
            message: d.message
          })));
          setMenuDbDuplicates(summary.dbDuplicates);
          setMenuPreviewData({
            totalItems: summary.totalRows || 0,
            mappedItems: 0,
            unmappedItems: summary.totalRows || 0,
            issues: summary.dbDuplicates.map(d => ({
              row: 0,
              message: d.message
            }))
          });
          
          if (menuToastId) toast.dismiss(menuToastId);
          const id = toast.error(`Found ${summary.dbDuplicates.length} duplicate product(s) in the database. Please remove them from your file.`);
          setMenuToastId(id);
          return;
        }
        
        setMenuUploadStatus('success');
        setMenuPreviewData({
          totalItems: summary.totalRows || 0,
          mappedItems: summary.validRows || 0,
          unmappedItems: summary.invalidRows || 0,
          issues: summary.errors || []
        });
        
        const productMsg = summary.productsInserted ? ` ${summary.productsInserted} products added.` : '';
        const ingredientMsg = summary.ingredientsInserted ? ` ${summary.ingredientsInserted} ingredients added.` : '';
        
        if (menuToastId) toast.dismiss(menuToastId);
        const id = toast.success(`Menu data uploaded successfully!${productMsg}${ingredientMsg}`);
        setMenuToastId(id);
        
        if (onUploadSuccess) {
          onUploadSuccess(response.data);
        }
        
        setTimeout(() => {
          setMenuUploadStatus(null);
          setMenuFile(null);
          setMenuProgress(0);
          setMenuValidated(false);
          setMenuValidationErrors([]);
          setMenuDbDuplicates([]);
          setMenuIsValid(false);
        }, 3000);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setMenuUploadStatus('error');
      setMenuProgress(0);
      
      const errorMsg = error.response?.data?.error || error.message || 'Upload failed';
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error(`Upload failed: ${errorMsg}`);
      setMenuToastId(id);
      
      setTimeout(() => {
        setMenuUploadStatus(null);
      }, 3000);
    }
  };

  const handleMenuDiscard = () => {
    setMenuFile(null);
    setMenuUploadStatus(null);
    setMenuProgress(0);
    setMenuValidated(false);
    setMenuValidationErrors([]);
    setMenuDbDuplicates([]);
    setMenuIsValid(false);
    setMenuPreviewData({
      totalItems: 0,
      mappedItems: 0,
      unmappedItems: 0,
      issues: []
    });
    if (menuToastId) toast.dismiss(menuToastId);
    const id = toast('File discarded');
    setMenuToastId(id);
    console.log("Menu upload discarded");
  };

  // Progress bar component
  const ProgressBar = ({ progress, status }) => {
    const getColor = () => {
      if (status === 'error') return '#ef4444';
      if (status === 'success') return '#10b981';
      if (progress < 100) return '#3b82f6';
      return '#10b981';
    };

    return (
      <div className="progress-bar-container" style={{ marginTop: '10px' }}>
        <div className="progress-bar-track" style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#e5e7eb',
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          <div className="progress-bar-fill" style={{
            width: `${Math.min(progress, 100)}%`,
            height: '100%',
            backgroundColor: getColor(),
            borderRadius: '4px',
            transition: 'width 0.3s ease-in-out',
            position: 'relative'
          }}>
            {progress > 0 && progress < 100 && (
              <div className="progress-bar-animation" style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                animation: 'shimmer 1.5s infinite'
              }} />
            )}
          </div>
        </div>
        <div className="progress-bar-label" style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '4px',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          <span>{status === 'loading' ? 'Uploading...' : status === 'success' ? 'Complete!' : status === 'error' ? 'Failed' : 'Ready'}</span>
          <span>{Math.min(progress, 100)}%</span>
        </div>
        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    );
  };

  return (
    <div className="tabbed-container">
      {/* Tabs Header */}
      <div className="tabs-header1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content: Sales Data Upload */}
      {activeTab === "upload" && (
        <div className="tab-content">
          <div className="upload-row">
            {/* First Upload Section - Sales Data */}
            <div className="upload">
              <div className="upload-header">
                <div>
                  <h2 className="upload-title">Upload New Sales Data</h2>
                  <p className="upload-subtitle">
                    Drag and drop your sales export below. For Sales Data your file must have these columns: <strong>Item name, Category, Items sold, Gross sales, Items refunded, Refunds, Net sales</strong>
                  </p>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                className={`drop-zone ${isSalesDragging ? "dragging" : ""} ${salesFile ? "uploaded" : ""}`}
                onDrop={handleSalesFileDrop}
                onDragOver={handleSalesDragOver}
                onDragLeave={handleSalesDragLeave}
                onClick={() => document.getElementById("salesFileInput").click()}
              >
                <div className="drop-zone-icon">
                  <FiUploadCloud size={32} />
                </div>
                {salesFile ? (
                  <div className="uploaded-file-info">
                    <p className="file-name">{salesFile.name}</p>
                    <p className="file-size">
                      {(salesFile.size / 1024).toFixed(2)} KB
                    </p>
                    <button
                      className="remove-file"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSalesDiscard();
                      }}
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
                    <p className="drop-zone-formats">
                      Supported formats: CSV, .XLSX (Max 20MB)
                    </p>
                  </>
                )}
                <input
                  type="file"
                  id="salesFileInput"
                  className="file-input"
                  accept=".csv,.xlsx"
                  onChange={handleSalesFileSelect}
                />
              </div>

              {/* Upload Status with Progress Bar */}
              {salesUploadStatus === 'loading' && (
                <div className="upload-status loading">
                  <span className="spinner"></span>
                  Uploading...
                  <ProgressBar progress={salesProgress} status="loading" />
                </div>
              )}
              {salesUploadStatus === 'success' && (
                <div className="upload-status success">
                  <FiCheckCircle size={20} />
                  Upload successful!
                  <ProgressBar progress={100} status="success" />
                </div>
              )}
              {salesUploadStatus === 'error' && (
                <div className="upload-status error">
                  <FiXCircle size={20} />
                  Upload failed
                  <ProgressBar progress={salesProgress} status="error" />
                </div>
              )}

              {/* Data Preview for Sales - Always shown */}
              <div className="data-preview">
                <div className="preview-header">
                  <h3 className="preview-title">Preview & Validation</h3>
                  <div className="preview-status">
                    <span className={`status-badge ${salesIsValid ? "success" : salesFile ? "warning" : "warning"}`}>
                      <span className="status-dot"></span>
                      {salesIsValid ? "Validated" : salesFile ? "Needs Review" : "No file uploaded"}
                    </span>
                    <span className="status-separator">|</span>
                    <span className="status-records">
                      {salesPreviewData.totalRecords || 0} records found
                    </span>
                  </div>
                </div>

                <div className="preview-stats">
                  <div className="stat-box">
                    <p className="stat-label">Valid Records</p>
                    <p className="stat-value success">{salesPreviewData.validRecords || 0}</p>
                  </div>
                  <div className="stat-box">
                    <p className="stat-label">Invalid Records</p>
                    <p className="stat-value error">{salesPreviewData.invalidRecords || 0}</p>
                  </div>
                  <div className="stat-box">
                    <p className="stat-label">System Match</p>
                    <p className="stat-value">{salesPreviewData.systemMatch || '0%'}</p>
                  </div>
                </div>

                {/* Validation Issues */}
                {salesPreviewData.issues && salesPreviewData.issues.length > 0 && (
                  <div className="validation-issues">
                    <div className="issues-header">
                      <FiAlertCircle size={16} className="issues-icon" />
                      <p className="issues-title">
                        Validation Issues Identified ({salesPreviewData.issues.length})
                      </p>
                    </div>
                    <div className="issues-list">
                      {salesPreviewData.issues.map((issue, index) => (
                        <div className="issue-item" key={index}>
                          <span className="issue-text">
                            {issue.row ? `Row ${issue.row}: ` : ''}{issue.message}
                          </span>
                          {issue.row && issue.row > 1 && (
                            <button
                              className="issue-fix-btn"
                              onClick={() => handleSalesFixIssue(issue.row)}
                            >
                              Fix now
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="action-buttons">
                  <div className="buttonsact">
                    <button 
                      className="btn-secondary" 
                      onClick={handleSalesDiscard}
                      disabled={!salesFile || salesUploadStatus === 'loading'}
                    >
                      Discard
                    </button>
                    <button
                      className={`btn-primary ${salesUploadStatus === 'loading' ? 'loading' : ''}`}
                      onClick={handleSalesConfirm}
                      disabled={!salesFile || salesUploadStatus === 'loading' || !salesValidated || !salesIsValid}
                    >
                      {salesUploadStatus === 'loading' ? 'Uploading...' : 'Confirm & Process Upload'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Second Upload Section - Menu Data */}
            <div className="upload">
              <div className="upload-header">
                <div>
                  <h2 className="upload-title">Upload Menu Data</h2>
                  <p className="upload-subtitle">
                    Drag and drop your menu mapping file below. For Menu Data your file must have these columns: <strong>Product Name, Ingredients, Quantity, Unit, Price, Category</strong>
                  </p>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                className={`drop-zone ${isMenuDragging ? "dragging" : ""} ${menuFile ? "uploaded" : ""}`}
                onDrop={handleMenuFileDrop}
                onDragOver={handleMenuDragOver}
                onDragLeave={handleMenuDragLeave}
                onClick={() => document.getElementById("menuFileInput").click()}
              >
                <div className="drop-zone-icon">
                  <FiUploadCloud size={32} />
                </div>
                {menuFile ? (
                  <div className="uploaded-file-info">
                    <p className="file-name">{menuFile.name}</p>
                    <p className="file-size">
                      {(menuFile.size / 1024).toFixed(2)} KB
                    </p>
                    <button
                      className="remove-file"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMenuDiscard();
                      }}
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
                    <p className="drop-zone-formats">
                      Supported formats: CSV, .XLSX (Max 20MB)
                    </p>
                  </>
                )}
                <input
                  type="file"
                  id="menuFileInput"
                  className="file-input"
                  accept=".csv,.xlsx"
                  onChange={handleMenuFileSelect}
                />
              </div>

              {/* Upload Status with Progress Bar */}
              {menuUploadStatus === 'loading' && (
                <div className="upload-status loading">
                  <span className="spinner"></span>
                  Uploading...
                  <ProgressBar progress={menuProgress} status="loading" />
                </div>
              )}
              {menuUploadStatus === 'success' && (
                <div className="upload-status success">
                  <FiCheckCircle size={20} />
                  Upload successful!
                  <ProgressBar progress={100} status="success" />
                </div>
              )}
              {menuUploadStatus === 'error' && (
                <div className="upload-status error">
                  <FiXCircle size={20} />
                  Upload failed
                  <ProgressBar progress={menuProgress} status="error" />
                </div>
              )}

              {/* Data Preview for Menu - Always shown */}
              <div className="data-preview">
                <div className="preview-header">
                  <h3 className="preview-title">Menu Preview & Validation</h3>
                  <div className="preview-status">
                    <span className={`status-badge ${menuIsValid ? "success" : menuFile ? "warning" : "warning"}`}>
                      <span className="status-dot"></span>
                      {menuIsValid ? "Validated" : menuFile ? "Needs Review" : "No file uploaded"}
                    </span>
                    <span className="status-separator">|</span>
                    <span className="status-records">
                      {menuPreviewData.totalItems || 0} items found
                    </span>
                  </div>
                </div>

                <div className="preview-stats">
                  <div className="stat-box">
                    <p className="stat-label">Menu Items</p>
                    <p className="stat-value success">{menuPreviewData.totalItems || 0}</p>
                  </div>
                  <div className="stat-box">
                    <p className="stat-label">Mapped Items</p>
                    <p className="stat-value">{menuPreviewData.mappedItems || 0}</p>
                  </div>
                  <div className="stat-box">
                    <p className="stat-label">Unmapped</p>
                    <p className="stat-value error">{menuPreviewData.unmappedItems || 0}</p>
                  </div>
                </div>

                {/* Menu Validation Issues */}
                {menuPreviewData.issues && menuPreviewData.issues.length > 0 && (
                  <div className="validation-issues">
                    <div className="issues-header">
                      <FiAlertCircle size={16} className="issues-icon" />
                      <p className="issues-title">
                        Mapping Issues Found ({menuPreviewData.issues.length})
                      </p>
                    </div>
                    <div className="issues-list">
                      {menuPreviewData.issues.map((issue, index) => (
                        <div className="issue-item" key={index}>
                          <span className="issue-text">
                            {issue.row ? `Row ${issue.row}: ` : ''}{issue.message}
                          </span>
                          {issue.row && issue.row > 1 && (
                            <button className="issue-fix-btn">
                              Fix now
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="action-buttons">
                  <div className="buttonsact">
                    <button 
                      className="btn-secondary" 
                      onClick={handleMenuDiscard}
                      disabled={!menuFile || menuUploadStatus === 'loading'}
                    >
                      Discard
                    </button>
                    <button
                      className={`btn-primary ${menuUploadStatus === 'loading' ? 'loading' : ''}`}
                      onClick={handleMenuConfirm}
                      disabled={!menuFile || menuUploadStatus === 'loading' || !menuValidated || !menuIsValid}
                    >
                      {menuUploadStatus === 'loading' ? 'Uploading...' : 'Process Menu Data'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical Data Tab */}
      {activeTab === "historical" && (
        <div className="tab-content">
          <HistoricalData />
        </div>
      )}

      {/* Menu & Ingredient Mapping Tab */}
      {activeTab === "mapping" && (
        <div className="tab-content">
          <MappingData />
        </div>
      )}
    </div>
  );
};

export default UploadData;