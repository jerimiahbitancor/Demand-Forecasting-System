// frontend/src/features/landing/landing-kit/LandingNav.jsx
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { FaBars, FaTimes } from 'react-icons/fa';
import { useBusinessLogo } from '../../../context/BusinessProfileContext';
import './landing-kit.css';

const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Features', to: '/features' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const businessLogo = useBusinessLogo();
  const { pathname } = useLocation();

  const closeDrawer = () => setOpen(false);

  // Clicking the logo while already on the home route has to scroll back up.
  // ScrollManager (App.jsx) only reacts to a *pathname change*, so a / -> /
  // click is invisible to it and leaves you stranded wherever you scrolled to.
  // When arriving from another route we deliberately stay out of the way and
  // let ScrollManager's reset own the jump - scrolling here too would animate
  // the page you are in the middle of leaving.
  const goHome = useCallback(() => {
    if (pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [pathname]);

  // Shadow/border once the page scrolls
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`lk-nav ${stuck ? 'is-stuck' : ''}`}>
      <div className="lk-container">
        <div className="lk-nav-inner">
          <Link
            to="/"
            className="lk-brand"
            aria-label="ChefDuo Forecast home"
            onClick={goHome}
          >
            <span className="lk-brand-mark" aria-hidden="true">
              <img src={businessLogo} alt="" />
            </span>
            <span className="lk-brand-text">
              <span className="lk-brand-name">ChefDuo Forecast</span>
              <span className="lk-brand-tag">Demand Forecasting</span>
            </span>
          </Link>

          <nav className="lk-nav-links" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `lk-nav-link ${isActive ? 'is-active' : ''}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="lk-nav-actions">
            <Link to="/login" className="lk-btn lk-btn--ghost lk-nav-cta">
              Sign in
            </Link>
            <Link to="/register" className="lk-btn lk-btn--primary lk-nav-cta">
              Get Started
            </Link>

            <button
              type="button"
              className="lk-burger"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="lk-mobile-drawer"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <FaTimes /> : <FaBars />}
            </button>
          </div>
        </div>
      </div>

      <div
        id="lk-mobile-drawer"
        className={`lk-drawer ${open ? 'is-open' : ''}`}
      >
        <div className="lk-container">
          <div className="lk-drawer-inner">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                onClick={closeDrawer}
                className={({ isActive }) =>
                  `lk-drawer-link ${isActive ? 'is-active' : ''}`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <div className="lk-drawer-actions">
              <Link
                to="/login"
                onClick={closeDrawer}
                className="lk-btn lk-btn--secondary lk-btn--block"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                onClick={closeDrawer}
                className="lk-btn lk-btn--primary lk-btn--block"
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
