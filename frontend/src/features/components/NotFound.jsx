// frontend/src/features/components/NotFound.jsx
//
// Custom 404 page shown by the catch-all route in App.jsx. Built from the same
// design scheme as the rest of the app (see App.css): cream surface, deep
// maroon primary, orange accent, Plus Jakarta Sans.
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaUtensils, FaHome, FaArrowLeft } from 'react-icons/fa';
import './NotFound.css';

const NotFound = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <div className="not-found-badge" aria-hidden="true">
          <FaUtensils />
        </div>

        <p className="not-found-code" aria-hidden="true">404</p>

        <h1 className="not-found-title">This dish isn&apos;t on the menu</h1>
        <p className="not-found-text">
          The page you&apos;re looking for doesn&apos;t exist, was moved, or the
          link is broken. Let&apos;s get you back to the kitchen.
        </p>

        {pathname && pathname !== '/' && (
          <p className="not-found-path">
            <span className="not-found-path-label">Requested</span>
            <code>{pathname}</code>
          </p>
        )}

        <div className="not-found-actions">
          <Link to="/" className="btn-primary not-found-btn">
            <FaHome aria-hidden="true" />
            Back to Home
          </Link>
          <button
            type="button"
            className="btn-secondary not-found-btn"
            onClick={() => navigate(-1)}
          >
            <FaArrowLeft aria-hidden="true" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
