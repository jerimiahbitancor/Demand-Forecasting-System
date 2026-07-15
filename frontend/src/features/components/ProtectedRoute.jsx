// frontend/src/features/components/reports/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './ProtectedRoute.css';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="protected-route-loading">
        <div className="protected-route-card">
          <div className="protected-route-spinner">
            <div className="protected-route-spinner-ring"></div>
          </div>
          <h3 className="protected-route-title">Loading</h3>
          <p className="protected-route-subtitle protected-route-dots">
            Please wait
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;