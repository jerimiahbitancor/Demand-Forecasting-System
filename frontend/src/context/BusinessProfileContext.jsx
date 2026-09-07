import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { authService } from '../services/authService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const STORAGE_KEY = 'business_logo_url';
const LOGO_EVENT = 'business-profile:updated';

const BusinessProfileContext = createContext(null);

export const getStoredBusinessLogo = () => {
  if (typeof window === 'undefined') return '/logo.png';
  return window.localStorage.getItem(STORAGE_KEY) || '/logo.png';
};

export const publishBusinessProfile = (profile) => {
  if (typeof window === 'undefined') return;
  const logo = profile?.logo || null;
  if (logo) {
    window.localStorage.setItem(STORAGE_KEY, logo);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(LOGO_EVENT, { detail: profile || {} }));
};

export const BusinessProfileProvider = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState(() => ({
    logo: getStoredBusinessLogo(),
  }));

  useEffect(() => {
    const handleProfileUpdate = (event) => {
      const nextProfile = event.detail || {};
      setProfile((current) => ({ ...current, ...nextProfile, logo: nextProfile.logo || getStoredBusinessLogo() }));
    };

    window.addEventListener(LOGO_EVENT, handleProfileUpdate);
    return () => window.removeEventListener(LOGO_EVENT, handleProfileUpdate);
  }, []);

  useEffect(() => {
    if (authLoading || !user) return undefined;
    let active = true;

    const loadProfile = async () => {
      try {
        const headers = await authService.getAuthHeaders();
        const response = await fetch(`${API_URL}/settings/business-profile`, { headers });
        const result = await response.json();
        if (active && result.success && result.data) {
          setProfile(result.data);
          publishBusinessProfile(result.data);
        }
      } catch (error) {
        console.warn('Unable to load business branding:', error);
      }
    };

    loadProfile();
    return () => { active = false; };
  }, [authLoading, user]);

  return (
    <BusinessProfileContext.Provider value={profile}>
      {children}
    </BusinessProfileContext.Provider>
  );
};

export const useBusinessProfile = () => {
  const context = useContext(BusinessProfileContext);
  if (!context) throw new Error('useBusinessProfile must be used within BusinessProfileProvider');
  return context;
};

export const useBusinessLogo = () => useBusinessProfile().logo || '/logo.png';
