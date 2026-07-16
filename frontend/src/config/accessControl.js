// Temporary presentation toggle for route guards.
// Set VITE_ENABLE_TEMP_ACCESS_BYPASS=true to allow dashboard/analytics access without the guard.
// Set it to false to restore the normal validation behavior.
export const TEMPORARY_ACCESS_BYPASS = import.meta.env.VITE_ENABLE_TEMP_ACCESS_BYPASS === 'true';
