// src/hooks/useSetupGuard.js
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';

// mode: 'entry'    -> always redirect to the correct page (used by "/")
//       'login'    -> this page expects a user to exist
//       'register' -> this page expects NO user yet
export function useSetupGuard(mode) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const result = await authService.hasUser();
      if (!active) return;

      if (result.success && result.data) {
        const hasUser = result.data.hasUser;

        if (mode === 'entry') {
          navigate(hasUser ? '/login' : '/register', { replace: true });
          return;
        }
        if (mode === 'login' && !hasUser) {
          navigate('/register', { replace: true });
          return;
        }
        if (mode === 'register' && hasUser) {
          navigate('/login', { replace: true });
          return;
        }
      }
      setChecking(false);
    };

    check();
    return () => { active = false; };
  }, [mode, navigate]);

  return checking;
}