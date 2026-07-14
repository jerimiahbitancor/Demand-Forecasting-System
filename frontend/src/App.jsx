// App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Register from './features/auth/pages/register/Register';
import VerifyEmail from './features/auth/pages/register/VerifyEmail';
import CreatePassword from './features/auth/pages/register/CreatePassword';
import Login from './features/auth/pages/login/Login';
import { useSetupGuard } from './hooks/useSetupGuard';
import ProtectedRoute from './features/components/ProtectedRoute';
import RequireUpload from './features/components/RequireUpload';
import ForgotPassword from './features/auth/pages/forgotpass/forgotpass';
import ForgotPassword2 from './features/auth/pages/forgotpass/forgotpass2';
import ChefDuoLanding from './features/landing/ChefDuoLanding';
import Dashboard from './features/dashboard/pages/Dashboard';
import DataManagement from './features/datamanagement/pages/DataManagement';
import Forecasting from './features/Analytics/Forecasting';
import ProductPerformance from './features/Analytics/ProductPerformance';
import IngredientDemand from './features/Analytics/components/IngredientDemand';
import Settings from './features/settings/Settings';
import Analytics from './features/Analytics/pages/Analytics';
import './App.css';

// ✅ RouteGuard wrapper
function RouteGuard({ children, mode }) {
  const checking = useSetupGuard(mode);
  if (checking) return <p>Loading...</p>;
  return children;
}

function RootRedirect() {
  useSetupGuard('entry');
  return <p>Loading...</p>;
}

function Gated({ children }) {
  return (
    <ProtectedRoute>
      <RequireUpload>{children}</RequireUpload>
    </ProtectedRoute>
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
        {/* Auth Routes - WITH GUARDS */}
        <Route path="/" element={<RootRedirect />} />
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
        <Route path="/forgot-password/reset" element={<ForgotPassword2 />} />

        {/* Landing Page - Protected */}
        <Route path="/landing" element={<ProtectedRoute><ChefDuoLanding /></ProtectedRoute>} />

        {/* Data Management - Protected */}
        <Route path="/data-management" element={<ProtectedRoute><DataManagement /></ProtectedRoute>} />

        {/* Main App Routes - Protected + Gated */}
        <Route path="/dashboard" element={<Gated><Dashboard /></Gated>} />
        <Route path="/analytics" element={<Gated><Analytics /></Gated>} />

        {/* Analytics sub-routes */}
        <Route path="/forecasting" element={<Gated><Forecasting /></Gated>} />
        <Route path="/product-performance" element={<Gated><ProductPerformance /></Gated>} />
        <Route path="/ingredient-demand" element={<Gated><IngredientDemand /></Gated>} />

        {/* Settings - Protected */}
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        {/* Profile */}
        <Route path="/profile" element={<Navigate to="/settings" replace />} />
      </Routes>
    </div>
  );
}

export default App;