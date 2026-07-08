import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../../services/authService';
import './AuthSetup.css';

const AuthSetup = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const result = await authService.hasUser();
        if (result.success && result.data) {
          if (result.data.hasUser) {
            navigate('/login', { replace: true });
          } else {
            navigate('/register', { replace: true });
          }
        } else {
          throw new Error(result.error || 'Unable to determine setup state');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    checkSetup();
  }, [navigate]);

  return (
    <div className="auth-setup-container">
      <main className="auth-setup-main">
        <div className="auth-setup-card">
          {loading ? (
            <p>Checking setup status...</p>
          ) : error ? (
            <div className="alert alert-error">{error}</div>
          ) : (
            <p>Redirecting...</p>
          )}
        </div>
      </main>
    </div>
  );
};

export default AuthSetup;
