// components/RequireUpload.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from "../../context/AuthContext";
import { TEMPORARY_ACCESS_BYPASS } from '../../config/accessControl';

const RequireUpload = ({ children }) => {
  if (TEMPORARY_ACCESS_BYPASS) {
    return children;
  }

  const { hasUploadedData, checkingUpload, loading } = useAuth();

  if (loading || checkingUpload) {
    return <p>Checking your data...</p>;
  }

  if (!hasUploadedData) {
    return <Navigate to="/landing" replace />;
  }

  return children;
};

export default RequireUpload;