// frontend/src/components/Toast/use_toast.js
import { useState, useCallback, useRef } from "react";

const MODAL_TO_TOAST_DELAY_MS = 250; // gives the eye a beat after the modal closes
const TOAST_VISIBLE_MS = 4500;

export function useToast() {
  const [toast, setToast] = useState(null); // { message, type }
  const showTimer = useRef(null);
  const dismissTimer = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    clearTimeout(showTimer.current);
    clearTimeout(dismissTimer.current);

    // Call this the instant the modal closes. The toast itself waits
    // ~250ms before appearing, so it never visually collides with the
    // modal's own close animation.
    showTimer.current = setTimeout(() => {
      setToast({ message, type });
      dismissTimer.current = setTimeout(() => setToast(null), TOAST_VISIBLE_MS);
    }, MODAL_TO_TOAST_DELAY_MS);
  }, []);

  const dismissToast = useCallback(() => {
    clearTimeout(showTimer.current);
    clearTimeout(dismissTimer.current);
    setToast(null);
  }, []);

  return { toast, showToast, dismissToast };
}