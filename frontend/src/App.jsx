// frontend/src/App.jsx
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Register from './features/auth/pages/register/Register';
import VerifyEmail from './features/auth/pages/register/VerifyEmail';
import CreatePassword from './features/auth/pages/register/CreatePassword';
import Login from './features/auth/pages/login/Login';
import { useSetupGuard } from './hooks/useSetupGuard';
import ProtectedRoute from './features/components/ProtectedRoute';
import { TEMPORARY_ACCESS_BYPASS } from './config/accessControl';
import ForgotPassword from './features/auth/pages/forgotpass/ForgotPassword';
import ResetPassword from './features/auth/pages/forgotpass/ResetPassword';
import ChefDuoLanding from './features/landing/ChefDuoLanding';
import Dashboard from './features/dashboard/pages/Dashboard';
import DataManagement from './features/datamanagement/pages/DataManagement';
import Forecasting from './features/analytics/components/Forecasting';
import ProductPerformance from './features/analytics/components/ProductPerformance';
import IngredientDemand from './features/analytics/components/IngredientDemand';
import Settings from './features/settings/pages/Settings';
import Analytics from './features/analytics/pages/Analytics';
import InventoryManagement from './features/inventory/pages/InventoryManagement';
import IngredientManagement from './features/inventory/pages/IngredientManagement';
import './App.css';
import './RouteGuard.css';
import Landing from './features/landing/Landing';

// Import individual state components
import FullyOperational from './features/dashboard/states/FullyOperational';
import NoData from './features/dashboard/states/NoData';
import UploadedInsufficient from './features/dashboard/states/UploadedInsufficient';
import TrainingInProgress from './features/dashboard/states/TrainingInProgress';
import ForecastsReady from './features/dashboard/states/ForecastsReady';
import DataNeedsAttention from './features/dashboard/states/DataNeedsAttention';

function RouteGuard({ children, mode }) {
  const checking = useSetupGuard(mode);
  
  if (checking) {
    return (
      <div className="route-guard-loading">
        <div className="route-guard-card">
          <div className="route-guard-spinner">
            <div className="route-guard-spinner-ring"></div>
          </div>
          <h3 className="route-guard-title">Loading</h3>
          <p className="route-guard-subtitle route-guard-dots">
            Please wait
          </p>
        </div>
      </div>
    );
  }
  
  return children;
}

function LandingRoute() {
  const checking = useSetupGuard('entry');
  
  if (checking) {
    return (
      <div className="route-guard-loading">
        <div className="route-guard-card">
          <div className="route-guard-spinner">
            <div className="route-guard-spinner-ring"></div>
          </div>
          <h3 className="route-guard-title">Loading</h3>
          <p className="route-guard-subtitle route-guard-dots">
            Please wait
          </p>
        </div>
      </div>
    );
  }
  
  return <Landing />;
}

function Gated({ children }) {
  if (TEMPORARY_ACCESS_BYPASS) {
    return children;
  }

  return (
    <ProtectedRoute>
      {children}
    </ProtectedRoute>
  );
}

// Wrapper component to handle state parameter for dashboard
function DashboardWrapper() {
  const [searchParams] = useSearchParams();
  const stateParam = searchParams.get('state');
  
  // State mapping for URL parameters
  const stateMap = {
    'fully-operational': FullyOperational,
    'no-data': NoData,
    'uploaded-insufficient': UploadedInsufficient,
    'training': TrainingInProgress,
    'forecasts-ready': ForecastsReady,
    'data-needs-attention': DataNeedsAttention,
  };
  
  // If state parameter is provided, show specific state
  if (stateParam) {
    const SpecificState = stateMap[stateParam];
    if (SpecificState) {
      return (
        <Gated>
          <SpecificState />
        </Gated>
      );
    }
  }
  
  // Default: Show the main Dashboard with state switcher
  return (
    <Gated>
      <Dashboard />
    </Gated>
  );
}

function App() {
  return (
    <div className="app-container">
      <Toaster
        position="top-right"
        reverseOrder={false}
        gutter={8}
        containerClassName=""
        containerStyle={{}}
        toastOptions={{
          className: '',
          duration: 5000,
          style: {
            background: '#1f2937',
            color: '#f3f4f6',
            padding: '16px 20px',
            borderRadius: '12px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          },
          success: {
            duration: 4000,
            iconTheme: {
              primary: '#10b981',
              secondary: '#ffffff',
            },
            style: {
              background: '#065f46',
              color: '#d1fae5',
              border: '1px solid #10b981',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#ffffff',
            },
            style: {
              background: '#7f1d1d',
              color: '#fecaca',
              border: '1px solid #ef4444',
            },
          },
          loading: {
            duration: 3000,
            style: {
              background: '#1e3a5f',
              color: '#93c5fd',
              border: '1px solid #3b82f6',
            },
          },
        }}
      />

      <Routes>
        {/* Landing Page - with entry guard */}
        <Route path="/" element={<LandingRoute />} />

        {/* Auth Routes */}
        <Route path="/login" element={
          <RouteGuard mode="login">
            <Login />
          </RouteGuard>
        } />
        <Route path="/register" element={
          <RouteGuard mode="register">
            <Register />
          </RouteGuard>
        } />
        <Route path="/verify-email" element={
          <RouteGuard mode="verify">
            <VerifyEmail />
          </RouteGuard>
        } />
        <Route path="/create-password" element={
          <RouteGuard mode="create-password">
            <CreatePassword />
          </RouteGuard>
        } />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/forgot-password/reset" element={<ResetPassword />} />

        {/* ChefDuo Landing - Protected */}
        <Route path="/chefduo" element={<ProtectedRoute><ChefDuoLanding /></ProtectedRoute>} />

        {/* Data Management - Protected */}
        <Route path="/data-management" element={<ProtectedRoute><DataManagement /></ProtectedRoute>} />

        {/* Main App Routes - Protected + Gated */}
        <Route path="/dashboard" element={<DashboardWrapper />} />
        <Route path="/analytics" element={<Gated><Analytics /></Gated>} />
        <Route path="/inventory-management" element={<InventoryManagement />} />
        <Route path="/ingredient-management" element={<IngredientManagement />} />
        
        {/* Analytics sub-routes */}
        <Route path="/forecasting" element={<Gated><Forecasting /></Gated>} />
        <Route path="/product-performance" element={<Gated><ProductPerformance /></Gated>} />
        <Route path="/ingredient-demand" element={<Gated><IngredientDemand /></Gated>} />

        {/* Settings - Protected */}
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        {/* Profile */}
        <Route path="/profile" element={<Navigate to="/settings" replace />} />
        
        {/* ============================================================ */}
        {/* DIRECT ROUTES - Access individual dashboard states */}
        {/* These work in all environments */}
        {/* ============================================================ */}
        <Route path="/dashboard/fully-operational" element={
          <Gated><FullyOperational /></Gated>
        } />
        <Route path="/dashboard/no-data" element={
          <Gated><NoData /></Gated>
        } />
        <Route path="/dashboard/uploaded-insufficient" element={
          <Gated><UploadedInsufficient /></Gated>
        } />
        <Route path="/dashboard/training" element={
          <Gated><TrainingInProgress /></Gated>
        } />
        <Route path="/dashboard/forecasts-ready" element={
          <Gated><ForecastsReady /></Gated>
        } />
        <Route path="/dashboard/data-needs-attention" element={
          <Gated><DataNeedsAttention /></Gated>
        } />
        
        {/* Catch-all - redirect to landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;