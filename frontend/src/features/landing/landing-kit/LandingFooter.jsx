// frontend/src/features/landing/landing-kit/LandingFooter.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaEnvelope,
  FaArrowRight,
  FaFileExcel,
  FaChartLine,
  FaBoxOpen,
  FaLock,
} from 'react-icons/fa';
import { PrivacyModal, TermsModal } from './LegalModals';
import { useBusinessLogo } from '../../../context/BusinessProfileContext';
import './landing-kit.css';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/features' },
      { label: 'How It Works', to: '/#how-it-works' },
      { label: 'Data Requirements', to: '/#data' },
      { label: 'Module Scope', to: '/features#scope' },
    ],
  },
  {
    title: 'Modules',
    links: [
      { label: 'Demand Forecasting', to: '/features#forecasting' },
      { label: 'Product Performance', to: '/features#performance' },
      { label: 'Ingredient Demand', to: '/features#ingredients' },
      { label: 'Inventory', to: '/features#inventory' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Sign In', to: '/login' },
      { label: 'Create Account', to: '/register' },
    ],
  },
];

const STEPS = [
  {
    icon: <FaFileExcel size={15} />,
    label: 'Upload',
    text: 'CSV or XLSX sales history',
  },
  {
    icon: <FaChartLine size={15} />,
    label: 'Forecast',
    text: 'Daily and weekly demand',
  },
  {
    icon: <FaBoxOpen size={15} />,
    label: 'Restock',
    text: 'Ingredient requirements',
  },
];

export default function LandingFooter({ onOpenPrivacy, onOpenTerms }) {
  const [modal, setModal] = useState(null);
  const businessLogo = useBusinessLogo();

  const openPrivacy = () => (onOpenPrivacy ? onOpenPrivacy() : setModal('privacy'));
  const openTerms = () => (onOpenTerms ? onOpenTerms() : setModal('terms'));

  return (
    <footer className="lk-footer">
      {/* Closing call to action */}
      <div className="lk-footer-cta">
         
      <div className="lk-container">
        <div className="lk-footer-grid">
          <div>
            <div className="lk-brand">
              <span className="lk-brand-mark" aria-hidden="true">
                <img src={businessLogo} alt="" />
              </span>
              <span className="lk-brand-text">
                <span className="lk-brand-name lk-brand-name--footer">
                  ChefDuo Forecast
                </span>
                <span className="lk-brand-tag">Demand Planning</span>
              </span>
            </div>
            <p className="lk-footer-brand-text">
              Turn historical sales data into actionable demand forecasts,
              ingredient requirements, and inventory insights for food service
              operations.
            </p>
            <a
              className="lk-footer-mail"
              href="mailto:BCF@gmail.com"
            >
              <span className="lk-footer-social" aria-hidden="true">
                <FaEnvelope />
              </span>
              <span>
                <span className="lk-footer-mail-label">Questions?</span>
                <span className="lk-footer-mail-value">BCF@gmail.com</span>
              </span>
            </a>
           
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="lk-footer-col-title">{col.title}</h4>
              <div className="lk-footer-links">
                {col.links.map((link) => (
                  <Link key={link.label} to={link.to} className="lk-footer-link">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="lk-footer-bar">
          <span>
            &copy; {new Date().getFullYear()} ChefDuo Forecast &middot; Demand
            Forecasting and Supply Chain Decision Support
          </span>
          <div className="lk-footer-bar-links">
            <button type="button" onClick={openPrivacy}>
              Privacy Policy
            </button>
            <button type="button" onClick={openTerms}>
              Terms &amp; Conditions
            </button>
          </div>
        </div>
      </div>
      </div>

      {modal === 'privacy' && <PrivacyModal onClose={() => setModal(null)} />}
      {modal === 'terms' && <TermsModal onClose={() => setModal(null)} />}
    </footer>
  );
}