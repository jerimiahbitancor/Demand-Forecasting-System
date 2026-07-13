// components/RequireUpload.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from "../../context/AuthContext";

const RequireUpload = ({ children }) => {
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