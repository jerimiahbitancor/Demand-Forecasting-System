// src/hooks/useSetupGuard.js
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import { TEMPORARY_ACCESS_BYPASS } from '../config/accessControl';
import { useAuth } from '../context/AuthContext';

export function useSetupGuard(mode) {
  const navigate = useNavigate();
  const { registrationData } = useAuth();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (TEMPORARY_ACCESS_BYPASS) {
      setChecking(false);
      return;
    }

    let active = true;

    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const isAuthenticated = !!session?.user;

        console.log('🔍 useSetupGuard - mode:', mode);
        console.log('🔍 isAuthenticated:', isAuthenticated);

        const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/auth/setup`, {
          cache: 'no-store'
        });
        const result = await response.json();
        
        console.log('🔍 /setup response:', result);

        if (!active) return;

        const hasUser = result?.success === true && typeof result.hasUser === 'boolean' ? result.hasUser : null;
        console.log('🔍 hasUser:', hasUser);

        // ENTRY PAGE - Landing
        if (mode === 'entry') {
          // If authenticated, go to dashboard
          if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
            return;
          }
          
          // If user exists but not logged in, show landing page
          // (they can click "Get Started" to go to login)
          setChecking(false);
          return;
        }

        // LOGIN PAGE
        if (mode === 'login') {
          if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
            return;
          }
          if (hasUser === true) {
            setChecking(false);
            return;
          }
          navigate('/register', { replace: true });
          return;
        }

        // REGISTER PAGE
        if (mode === 'register') {
          if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
            return;
          }
          if (hasUser === true) {
            navigate('/login', { replace: true });
            return;
          }
          setChecking(false);
          return;
        }

        // VERIFY EMAIL PAGE
        if (mode === 'verify') {
          if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
            return;
          }
          if (!registrationData?.email || !registrationData?.userId) {
            navigate('/register', { replace: true });
            return;
          }
          setChecking(false);
          return;
        }

        // CREATE PASSWORD PAGE
        if (mode === 'create-password') {
          if (isAuthenticated) {
            navigate('/dashboard', { replace: true });
            return;
          }
          if (!registrationData?.email || !registrationData?.userId || !registrationData?.otpVerified) {
            navigate('/verify-email', { replace: true });
            return;
          }
          setChecking(false);
          return;
        }

        setChecking(false);
        
      } catch (error) {
        console.error('Setup guard error:', error);
        if (active) setChecking(false);
      }
    };

    check();
    return () => { active = false; };
  }, [mode, navigate, registrationData]);

  return checking;
}