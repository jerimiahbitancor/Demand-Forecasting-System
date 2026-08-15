// components/UploadData.jsx
import { useState } from "react";
import {
  FiUploadCloud,
  FiAlertCircle,
  FiCheckCircle,
  FiXCircle,
  FiFile,
  FiTrash2,
  FiUpload,
  FiList,
  FiPlus
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
  const { getToken, checkUploadStatus } = useAuth();

  // Sales upload state - MULTIPLE FILES
  const [salesFiles, setSalesFiles] = useState([]);
  const [isSalesDragging, setIsSalesDragging] = useState(false);
  const [salesUploadStatus, setSalesUploadStatus] = useState(null);
  const [salesProgress, setSalesProgress] = useState(0);
  const [salesValidated, setSalesValidated] = useState(false);
  const [salesValidationErrors, setSalesValidationErrors] = useState([]);
  const [salesIsValid, setIsSalesValid] = useState(false);
  const [salesProcessingIndex, setSalesProcessingIndex] = useState(-1);
  const [salesUploadedCount, setSalesUploadedCount] = useState(0);

  // Menu upload state - MULTIPLE FILES
  const [menuFiles, setMenuFiles] = useState([]);
  const [isMenuDragging, setIsMenuDragging] = useState(false);
  const [menuUploadStatus, setMenuUploadStatus] = useState(null);
  const [menuProgress, setMenuProgress] = useState(0);
  const [menuValidated, setMenuValidated] = useState(false);
  const [menuValidationErrors, setMenuValidationErrors] = useState([]);
  const [menuDbDuplicates, setMenuDbDuplicates] = useState([]);
  const [menuIsValid, setMenuIsValid] = useState(false);
  const [menuProcessingIndex, setMenuProcessingIndex] = useState(-1);
  const [menuUploadedCount, setMenuUploadedCount] = useState(0);

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

  const apiClient = axios.create({
    baseURL: apiUrl || 'http://localhost:5000/api',
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    async (config) => {
      const token = await getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('Token added to request:', config.url);
      } else {
        console.warn('No token found for request:', config.url);
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

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

    const requiredColumns = ['Item name', 'Category', 'Items sold', 'Gross sales', 'Items refunded', 'Refunds', 'Net sales'];
    const headers = Object.keys(data[0]);
    
    console.log('Sales Headers found:', headers);
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

  // Sales handlers - MULTIPLE FILES
  const handleSalesFileDrop = (e) => {
    e.preventDefault();
    setIsSalesDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      validateAndSetSalesFiles(fileArray);
    }
  };

  const handleSalesFileSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      validateAndSetSalesFiles(fileArray);
    }
    // Reset input so same files can be selected again
    e.target.value = '';
  };

  const validateAndSetSalesFiles = async (files) => {
    const validFiles = [];
    const invalidFiles = [];
    
    for (const file of files) {
      const validTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
      if (!validTypes.includes(file.type) && !file.name.match(/\.(csv|xlsx)$/i)) {
        invalidFiles.push(file.name);
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        invalidFiles.push(`${file.name} (exceeds 20MB)`);
        continue;
      }

      validFiles.push(file);
    }

    if (invalidFiles.length > 0) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error(`Invalid files: ${invalidFiles.join(', ')}. Please upload CSV or XLSX files under 20MB.`);
      setSalesToastId(id);
    }

    if (validFiles.length === 0) return;

    setSalesFiles(prev => [...prev, ...validFiles]);
    setSalesUploadStatus(null);
    setSalesProgress(0);
    setSalesValidated(false);
    setSalesValidationErrors([]);
    setIsSalesValid(false);
    setSalesUploadedCount(0);
    console.log(`Sales files added: ${validFiles.length} files`);

    // Validate each file
    let totalValidRows = 0;
    let totalInvalidRows = 0;
    let allErrors = [];
    let allValid = true;

    for (const file of validFiles) {
      try {
        const data = await readFileData(file);
        const validation = validateSalesData(data);
        
        totalValidRows += validation.validRows;
        totalInvalidRows += validation.invalidRows;
        allErrors = [...allErrors, ...validation.errors.map(e => ({
          ...e,
          file: file.name
        }))];
        
        if (!validation.isValid) {
          allValid = false;
        }
      } catch (error) {
        console.error('Error reading file:', error);
        allErrors.push({
          row: 0,
          message: `Error reading ${file.name}: ${error.message}`,
          file: file.name
        });
        allValid = false;
      }
    }

    const totalRows = totalValidRows + totalInvalidRows;
    
    setSalesPreviewData({
      totalRecords: totalRows,
      validRecords: totalValidRows,
      invalidRecords: totalInvalidRows,
      systemMatch: totalRows > 0 ? 
        `${Math.round((totalValidRows / totalRows) * 100)}%` : '0%',
      issues: allErrors.slice(0, 10)
    });
    
    setSalesValidated(true);
    setSalesValidationErrors(allErrors);
    setIsSalesValid(allValid);
    
    if (allValid) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.success(`All ${validFiles.length} files validated: ${totalValidRows} valid records found`);
      setSalesToastId(id);
    } else {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error(`Files have ${totalInvalidRows} issues. Please review the preview below.`);
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

  const removeSalesFile = (index) => {
    setSalesFiles(prev => prev.filter((_, i) => i !== index));
    if (salesFiles.length <= 1) {
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
    }
  };

  const handleSalesConfirm = async () => {
    if (salesFiles.length === 0) {
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.error('Please select files first');
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
      const id = toast.error('Cannot upload. Please fix validation issue(s) first.');
      setSalesToastId(id);
      return;
    }
    
    try {
      setSalesUploadStatus('loading');
      setSalesProgress(0);
      setSalesProcessingIndex(0);
      setSalesUploadedCount(0);
      
      const totalFiles = salesFiles.length;
      let uploaded = 0;
      
      for (let i = 0; i < totalFiles; i++) {
        setSalesProcessingIndex(i);
        
        const formData = new FormData();
        formData.append('file', salesFiles[i]);
        formData.append('fileType', 'sales');

        console.log(`Uploading sales file ${i + 1}/${totalFiles}: ${salesFiles[i].name}`);

        const response = await apiClient.post('/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const overallProgress = Math.round(((i + (percentCompleted / 100)) / totalFiles) * 100);
            setSalesProgress(overallProgress);
          }
        });

        if (response?.data?.success) {
          uploaded++;
          setSalesUploadedCount(uploaded);
          
          if (salesToastId) toast.dismiss(salesToastId);
          const id = toast.success(`Uploaded ${uploaded}/${totalFiles}: ${salesFiles[i].name}`);
          setSalesToastId(id);
        } else {
          throw new Error(response?.data?.error || `Failed to upload ${salesFiles[i].name}`);
        }
      }

      setSalesProgress(100);
      setSalesUploadStatus('success');
      
      const summary = {
        totalRows: salesPreviewData.totalRecords,
        validRows: salesPreviewData.validRecords,
        invalidRows: salesPreviewData.invalidRows,
        errors: salesPreviewData.issues,
        filesUploaded: uploaded,
        totalFiles: totalFiles
      };
      
      setSalesPreviewData({
        ...salesPreviewData,
        systemMatch: salesPreviewData.totalRecords > 0 ? 
          `${Math.round((salesPreviewData.validRecords / salesPreviewData.totalRecords) * 100)}%` : '0%'
      });
      
      if (salesToastId) toast.dismiss(salesToastId);
      const id = toast.success(`Successfully uploaded ${uploaded}/${totalFiles} files! ${salesPreviewData.validRecords || 0} records processed.`);
      setSalesToastId(id);
      
      await checkUploadStatus();
      
      if (onUploadSuccess) {
        onUploadSuccess({ filesUploaded: uploaded, totalFiles });
      }
      
      setTimeout(() => {
        setSalesUploadStatus(null);
        setSalesFiles([]);
        setSalesProgress(0);
        setSalesValidated(false);
        setSalesValidationErrors([]);
        setIsSalesValid(false);
        setSalesProcessingIndex(-1);
        setSalesUploadedCount(0);
        setSalesPreviewData({
          totalRecords: 0,
          validRecords: 0,
          invalidRecords: 0,
          systemMatch: "0%",
          issues: []
        });
      }, 5000);
      
    } catch (error) {
      console.error('Upload error:', error);
      console.error('Error response:', error.response?.data);
      
      setSalesUploadStatus('error');
      setSalesProgress(0);
      
      const errorMsg = error.response?.data?.error || error.message || 'Upload failed';
      const details = error.response?.data?.details || '';
      
      if (salesToastId) toast.dismiss(salesToastId);
      
      if (error.response?.status === 409) {
        const id = toast.error(`Upload failed: ${error.response?.data?.message || 'Duplicate file detected'}`);
        setSalesToastId(id);
      } else if (error.response?.status === 400) {
        const id = toast.error(`Validation error: ${details || errorMsg}`);
        setSalesToastId(id);
      } else if (error.response?.status === 500) {
        const id = toast.error(`Server error: ${details || errorMsg}`);
        setSalesToastId(id);
      } else {
        const id = toast.error(`Upload failed: ${errorMsg}`);
        setSalesToastId(id);
      }
      
      setTimeout(() => {
        setSalesUploadStatus(null);
        setSalesProcessingIndex(-1);
      }, 3000);
    }
  };

  const handleSalesDiscard = () => {
    setSalesFiles([]);
    setSalesUploadStatus(null);
    setSalesProgress(0);
    setSalesValidated(false);
    setSalesValidationErrors([]);
    setIsSalesValid(false);
    setSalesProcessingIndex(-1);
    setSalesUploadedCount(0);
    setSalesPreviewData({
      totalRecords: 0,
      validRecords: 0,
      invalidRecords: 0,
      systemMatch: "0%",
      issues: []
    });
    if (salesToastId) toast.dismiss(salesToastId);
    const id = toast('All files discarded');
    setSalesToastId(id);
  };

  const handleSalesFixIssue = (row) => {
    if (salesToastId) toast.dismiss(salesToastId);
    const id = toast(`Fixing issue at row ${row}...`);
    setSalesToastId(id);
  };

  // Menu handlers - MULTIPLE FILES
  const handleMenuFileDrop = (e) => {
    e.preventDefault();
    setIsMenuDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      validateAndSetMenuFiles(fileArray);
    }
  };

  const handleMenuFileSelect = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      validateAndSetMenuFiles(fileArray);
    }
    e.target.value = '';
  };

  const validateAndSetMenuFiles = async (files) => {
    const validFiles = [];
    const invalidFiles = [];
    
    for (const file of files) {
      const validTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
      if (!validTypes.includes(file.type) && !file.name.match(/\.(csv|xlsx)$/i)) {
        invalidFiles.push(file.name);
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        invalidFiles.push(`${file.name} (exceeds 20MB)`);
        continue;
      }

      validFiles.push(file);
    }

    if (invalidFiles.length > 0) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error(`Invalid files: ${invalidFiles.join(', ')}. Please upload CSV or XLSX files under 20MB.`);
      setMenuToastId(id);
    }

    if (validFiles.length === 0) return;

    setMenuFiles(prev => [...prev, ...validFiles]);
    setMenuUploadStatus(null);
    setMenuProgress(0);
    setMenuValidated(false);
    setMenuValidationErrors([]);
    setMenuDbDuplicates([]);
    setMenuIsValid(false);
    setMenuUploadedCount(0);
    console.log(`Menu files added: ${validFiles.length} files`);

    let totalValidRows = 0;
    let totalInvalidRows = 0;
    let allErrors = [];
    let allValid = true;

    for (const file of validFiles) {
      try {
        const data = await readFileData(file);
        const validation = validateMenuData(data);
        
        totalValidRows += validation.validRows;
        totalInvalidRows += validation.invalidRows;
        allErrors = [...allErrors, ...validation.errors.map(e => ({
          ...e,
          file: file.name
        }))];
        
        if (!validation.isValid) {
          allValid = false;
        }
      } catch (error) {
        console.error('Error reading file:', error);
        allErrors.push({
          row: 0,
          message: `Error reading ${file.name}: ${error.message}`,
          file: file.name
        });
        allValid = false;
      }
    }

    setMenuPreviewData({
      totalItems: totalValidRows + totalInvalidRows,
      mappedItems: totalValidRows,
      unmappedItems: totalInvalidRows,
      issues: allErrors.slice(0, 10)
    });
    
    setMenuValidated(true);
    setMenuValidationErrors(allErrors);
    setMenuIsValid(allValid);
    
    if (allValid) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.success(`All ${validFiles.length} menu files validated: ${totalValidRows} items ready`);
      setMenuToastId(id);
    } else {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error(`Menu files have ${totalInvalidRows} issues. Please review the preview below.`);
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

  const removeMenuFile = (index) => {
    setMenuFiles(prev => prev.filter((_, i) => i !== index));
    if (menuFiles.length <= 1) {
      setMenuValidated(false);
      setMenuValidationErrors([]);
      setMenuIsValid(false);
      setMenuPreviewData({
        totalItems: 0,
        mappedItems: 0,
        unmappedItems: 0,
        issues: []
      });
    }
  };

  const handleMenuConfirm = async () => {
    if (menuFiles.length === 0) {
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error('Please select files first');
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
      const id = toast.error('Cannot upload. Please fix validation issue(s) first.');
      setMenuToastId(id);
      return;
    }
    
    try {
      setMenuUploadStatus('loading');
      setMenuProgress(0);
      setMenuProcessingIndex(0);
      setMenuUploadedCount(0);
      
      const totalFiles = menuFiles.length;
      let uploaded = 0;
      
      for (let i = 0; i < totalFiles; i++) {
        setMenuProcessingIndex(i);
        
        const formData = new FormData();
        formData.append('file', menuFiles[i]);
        formData.append('fileType', 'menu');

        console.log(`Uploading menu file ${i + 1}/${totalFiles}: ${menuFiles[i].name}`);

        const response = await apiClient.post('/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const overallProgress = Math.round(((i + (percentCompleted / 100)) / totalFiles) * 100);
            setMenuProgress(overallProgress);
          }
        });

        if (response?.data?.success) {
          uploaded++;
          setMenuUploadedCount(uploaded);
          
          const summary = response?.data?.summary || {};
          
          if (summary.dbDuplicates && summary.dbDuplicates.length > 0) {
            if (menuToastId) toast.dismiss(menuToastId);
            const id = toast.error(`Found ${summary.dbDuplicates.length} duplicate product(s) in ${menuFiles[i].name}. Please remove them.`);
            setMenuToastId(id);
            // Continue with other files
            continue;
          }
          
          if (menuToastId) toast.dismiss(menuToastId);
          const id = toast.success(`Uploaded ${uploaded}/${totalFiles}: ${menuFiles[i].name}`);
          setMenuToastId(id);
        } else {
          throw new Error(response?.data?.error || `Failed to upload ${menuFiles[i].name}`);
        }
      }

      setMenuProgress(100);
      setMenuUploadStatus('success');
      
      const productMsg = ` ${menuPreviewData.mappedItems || 0} items mapped.`;
      
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.success(`Successfully uploaded ${uploaded}/${totalFiles} menu files!${productMsg}`);
      setMenuToastId(id);
      
      if (onUploadSuccess) {
        onUploadSuccess({ filesUploaded: uploaded, totalFiles });
      }
      
      setTimeout(() => {
        setMenuUploadStatus(null);
        setMenuFiles([]);
        setMenuProgress(0);
        setMenuValidated(false);
        setMenuValidationErrors([]);
        setMenuDbDuplicates([]);
        setMenuIsValid(false);
        setMenuProcessingIndex(-1);
        setMenuUploadedCount(0);
        setMenuPreviewData({
          totalItems: 0,
          mappedItems: 0,
          unmappedItems: 0,
          issues: []
        });
      }, 5000);
      
    } catch (error) {
      console.error('Menu upload error:', error);
      console.error('Error response:', error.response?.data);
      
      setMenuUploadStatus('error');
      setMenuProgress(0);
      
      const errorMsg = error.response?.data?.error || error.message || 'Upload failed';
      if (menuToastId) toast.dismiss(menuToastId);
      const id = toast.error(`Upload failed: ${errorMsg}`);
      setMenuToastId(id);
      
      setTimeout(() => {
        setMenuUploadStatus(null);
        setMenuProcessingIndex(-1);
      }, 3000);
    }
  };

  const handleMenuDiscard = () => {
    setMenuFiles([]);
    setMenuUploadStatus(null);
    setMenuProgress(0);
    setMenuValidated(false);
    setMenuValidationErrors([]);
    setMenuDbDuplicates([]);
    setMenuIsValid(false);
    setMenuProcessingIndex(-1);
    setMenuUploadedCount(0);
    setMenuPreviewData({
      totalItems: 0,
      mappedItems: 0,
      unmappedItems: 0,
      issues: []
    });
    if (menuToastId) toast.dismiss(menuToastId);
    const id = toast('All menu files discarded');
    setMenuToastId(id);
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

  // Helper to format file size
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Render file list
  const renderFileList = (files, onRemove, uploadStatus, processingIndex, uploadedCount) => {
    if (files.length === 0) return null;
    
    return (
      <div className="file-list-container">
        <div className="file-list-header">
          <span className="file-count">{files.length} file(s) selected</span>
          {uploadStatus === 'loading' && (
            <span className="upload-progress-info">
              Uploading {processingIndex + 1}/{files.length}...
              {uploadedCount > 0 && ` (${uploadedCount} completed)`}
            </span>
          )}
        </div>
        <div className="file-list">
          {files.map((file, index) => (
            <div key={index} className={`file-item ${uploadStatus === 'loading' && processingIndex === index ? 'processing' : ''}`}>
              <FiFile className="file-icon" />
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatFileSize(file.size)}</span>
              {uploadStatus === 'loading' && processingIndex === index && (
                <span className="file-status uploading">Uploading...</span>
              )}
              {uploadStatus === 'loading' && processingIndex > index && (
                <span className="file-status done">✓ Done</span>
              )}
              {uploadStatus !== 'loading' && (
                <button 
                  className="remove-file-btn"
                  onClick={() => onRemove(index)}
                  title="Remove file"
                >
                  <FiTrash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="tabbed-container">
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

      {activeTab === "upload" && (
        <div className="tab-content">
          <div className="upload-row">
            {/* First Upload Section - Sales Data */}
            <div className="upload">
              <div className="upload-headered">
                <div>
                  <h2 className="upload-title">Upload New Sales Data</h2>
                  <p className="upload-subtitle">
                    Drag and drop multiple sales files below. For Sales Data your files must have these columns: <strong>Item name, Category, Items sold, Gross sales, Items refunded, Refunds, Net sales</strong>
                  </p>
                  <p className="upload-hint">You can select multiple CSV or XLSX files at once.</p>
                </div>
                {salesFiles.length > 0 && (
                  <span className="file-badge">{salesFiles.length} files</span>
                )}
              </div>

              {/* Drag and Drop Zone */}
              <div
                className={`drop-zone ${isSalesDragging ? "dragging" : ""} ${salesFiles.length > 0 ? "uploaded" : ""}`}
                onDrop={handleSalesFileDrop}
                onDragOver={handleSalesDragOver}
                onDragLeave={handleSalesDragLeave}
                onClick={() => document.getElementById("salesFileInput").click()}
              >
                <div className="drop-zone-icon">
                  <FiUploadCloud size={32} />
                </div>
                {salesFiles.length > 0 ? (
                  <div className="uploaded-file-info">
                    <p className="file-count-text">{salesFiles.length} file(s) selected</p>
                    <p className="file-total-size">
                      Total: {formatFileSize(salesFiles.reduce((sum, f) => sum + f.size, 0))}
                    </p>
                    <button
                      className="remove-all-files"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSalesDiscard();
                      }}
                    >
                      Remove All
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="drop-zone-text">
                      Drag and Drop Files or{" "}
                      <span className="browse-link">Browse</span>
                    </p>
                    <p className="drop-zone-formats">
                      Supported formats: CSV, .XLSX (Max 20MB each)
                    </p>
                    <p className="drop-zone-hint">
                      <FiPlus size={14} /> Select multiple files
                    </p>
                  </>
                )}
                <input
                  type="file"
                  id="salesFileInput"
                  className="file-input"
                  accept=".csv,.xlsx"
                  multiple
                  onChange={handleSalesFileSelect}
                />
              </div>

              {/* File List */}
              {renderFileList(
                salesFiles, 
                removeSalesFile, 
                salesUploadStatus, 
                salesProcessingIndex, 
                salesUploadedCount
              )}

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
                    <span className={`status-badge ${salesIsValid ? "success" : salesFiles.length > 0 ? "warning" : "warning"}`}>
                      <span className="status-dot"></span>
                      {salesIsValid ? "Validated" : salesFiles.length > 0 ? "Needs Review" : "No files uploaded"}
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
                  <div className="stat-box">
                    <p className="stat-label">Files</p>
                    <p className="stat-value">{salesFiles.length}</p>
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
                            {issue.file && <span className="issue-file">[{issue.file}] </span>}
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
                      disabled={salesFiles.length === 0 || salesUploadStatus === 'loading'}
                    >
                      Discard All
                    </button>
                    <button
                      className={`btn-primary ${salesUploadStatus === 'loading' ? 'loading' : ''}`}
                      onClick={handleSalesConfirm}
                      disabled={salesFiles.length === 0 || salesUploadStatus === 'loading' || !salesValidated || !salesIsValid}
                    >
                      {salesUploadStatus === 'loading' ? 'Uploading...' : `Upload ${salesFiles.length} File(s)`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "historical" && (
        <div className="tab-content">
          <HistoricalData />
        </div>
      )}

      {activeTab === "mapping" && (
        <div className="tab-content">
          <MappingData />
        </div>
      )}
    </div>
  );
};

export default UploadData;