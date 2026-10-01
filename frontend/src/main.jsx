// main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { BusinessProfileProvider } from './context/BusinessProfileContext';
import { HelpProvider } from './context/HelpContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>  
      <AuthProvider>
        <BusinessProfileProvider>
          <HelpProvider>
            <App />
          </HelpProvider>
        </BusinessProfileProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);