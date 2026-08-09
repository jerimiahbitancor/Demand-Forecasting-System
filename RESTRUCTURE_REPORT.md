# Restructure Report

## Files moved/renamed
- `frontend/src/features/Analytics` → `frontend/src/features/analytics`
- `frontend/src/features/settings/Settings.jsx` → `frontend/src/features/settings/pages/Settings.jsx`
- `frontend/src/features/settings/Settings.css` → `frontend/src/features/settings/pages/Settings.css`
- `frontend/src/features/auth/pages/forgotpass/forgotpass.jsx` → `frontend/src/features/auth/pages/forgotpass/ForgotPassword.jsx`
- `frontend/src/features/auth/pages/forgotpass/forgotpass.css` → `frontend/src/features/auth/pages/forgotpass/ForgotPassword.css`
- `frontend/src/features/auth/pages/forgotpass/forgotpass2.jsx` → `frontend/src/features/auth/pages/forgotpass/ResetPassword.jsx`
- `frontend/src/features/auth/pages/forgotpass/forgotpass2.css` → `frontend/src/features/auth/pages/forgotpass/ResetPassword.css`
- `backend/controllers/product_controller.js` → `backend/controllers/productController.js`
- `backend/controllers/businessProfile.js` → `backend/controllers/businessProfileController.js`
- `backend/middleware/virus-scan.js` → `backend/middleware/virusScan.js`

## Files deleted
- `frontend/src/features/analytics/Forecasting.jsx`
- `frontend/src/features/analytics/Forecasting.css`
- `frontend/src/features/analytics/ProductPerformance.jsx`
- `frontend/src/features/analytics/ProductPerformance.css`
- `frontend/src/features/analytics/Analytics_ Forecasting (1).png`

## Import/reference updates

### `frontend/src/App.jsx`
- Before: `import ForgotPassword from './features/auth/pages/forgotpass/forgotpass';`
- After: `import ForgotPassword from './features/auth/pages/forgotpass/ForgotPassword';`

- Before: `import ForgotPassword2 from './features/auth/pages/forgotpass/forgotpass2';`
- After: `import ResetPassword from './features/auth/pages/forgotpass/ResetPassword';`

- Before: `import Forecasting from './features/Analytics/Forecasting';`
- After: `import Forecasting from './features/analytics/components/Forecasting';`

- Before: `import ProductPerformance from './features/Analytics/ProductPerformance';`
- After: `import ProductPerformance from './features/analytics/components/ProductPerformance';`

- Before: `import IngredientDemand from './features/Analytics/components/IngredientDemand';`
- After: `import IngredientDemand from './features/analytics/components/IngredientDemand';`

- Before: `import Settings from './features/settings/Settings';`
- After: `import Settings from './features/settings/pages/Settings';`

- Before: `import Analytics from './features/Analytics/pages/Analytics';`
- After: `import Analytics from './features/analytics/pages/Analytics';`

- Before: `import ForgotPassword2 from './features/auth/pages/forgotpass/forgotpass2';`
- After: `import ResetPassword from './features/auth/pages/forgotpass/ResetPassword';`

### `frontend/src/features/settings/pages/Settings.jsx`
- Before: `import Navbar from '../components/Navbar/Navbar.jsx';`
- After: `import Navbar from '../../components/Navbar/Navbar.jsx';`

### `frontend/src/features/components/Reports/GenerateReportModal.jsx`
- Before: `import DatePicker from "../../Analytics/components/shared/DatePicker.jsx";`
- After: `import DatePicker from "../../analytics/components/shared/DatePicker.jsx";`

### `frontend/src/features/auth/pages/forgotpass/ForgotPassword.jsx`
- Before: `import './forgotpass.css';`
- After: `import './ForgotPassword.css';`

### `frontend/src/features/auth/pages/forgotpass/ResetPassword.jsx`
- Before: `import './forgotpass2.css';`
- After: `import './ResetPassword.css';`

### `backend/routes/product.js`
- Before: `const ProductController = require('../controllers/product_controller');`
- After: `const ProductController = require('../controllers/productController');`

### `backend/routes/settings.js`
- Before: `const BusinessProfileController = require('../controllers/businessProfile');`
- After: `const BusinessProfileController = require('../controllers/businessProfileController');`

- Before: `const virusScan = require('../middleware/virus-scan');`
- After: `const virusScan = require('../middleware/virusScan');`

### `backend/routes/upload.js`
- Before: `const virusScan = require('../middleware/virus-scan');`
- After: `const virusScan = require('../middleware/virusScan');`

## Additional references found beyond the user list
- `frontend/src/features/components/Reports/GenerateReportModal.jsx` import path updated for the `DatePicker` shared component from `Analytics` to `analytics`.
- `frontend/src/features/settings/pages/Settings.jsx` required one extra `../` in the Navbar import after moving the Settings page file deeper into `pages/`.

## Verify
- Frontend build: succeeded (`npm run build` in `frontend` completed successfully)
- Backend start: succeeded (`npm start` in `backend` started the server without module-not-found errors)
