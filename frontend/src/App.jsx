// App.jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Register from '../src/features/auth/pages/register/Register';
import Login from '../src/features/auth/pages/login/Login';
import { useSetupGuard } from './hooks/useSetupGuard';
import ProtectedRoute from './features/components/ProtectedRoute';
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

function RootRedirect() {
  useSetupGuard('entry');
  return <p>Loading...</p>;
}

function App() {
  return (
    <div className="app-container">
      {/* Toast Notifications with custom styling */}
      <Toaster
        position="top-right"
        reverseOrder={false}
        gutter={8}
        containerClassName=""
        containerStyle={{}}
        toastOptions={{
          // Default options for all toasts
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
          // Success toast options
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
          // Error toast options
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
          // Loading toast options
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
        {/* Auth Routes — public */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/forgot-password/reset" element={<ForgotPassword2 />} />
        
        {/* Landing Page — protected */}
        <Route path="/landing" element={<ProtectedRoute><ChefDuoLanding /></ProtectedRoute>} />
        
        {/* Main App Routes — protected */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/data-management" element={<ProtectedRoute><DataManagement /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
        
        {/* Analytics Routes — protected */}
        <Route path="/forecasting" element={<ProtectedRoute><Forecasting /></ProtectedRoute>} />
        <Route path="/product-performance" element={<ProtectedRoute><ProductPerformance /></ProtectedRoute>} />
        <Route path="/ingredient-demand" element={<ProtectedRoute><IngredientDemand /></ProtectedRoute>} />
        
        {/* Settings — protected */}
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        
        {/* Profile */}
        <Route path="/profile" element={<Navigate to="/settings" replace />} />
      </Routes>
    </div>
  );
}

export default App;