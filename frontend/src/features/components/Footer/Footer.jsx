// Footer.jsx
import { Link } from 'react-router-dom';
import { FaFacebook, FaInstagram, FaYoutube, FaTwitter, FaEnvelope, FaPhone, FaMapMarkerAlt } from 'react-icons/fa';
import './Footer.css';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-container">
        {/* Column 1: Brand */}
        <div className="footer-column footer-brand">
          <h3 className="footer-brand-name">Chef Duo</h3>
          <p className="footer-brand-desc">
            ChefDuo's Demand Forecasting System.
          </p>
          <div className="footer-socials">
            <a href="https://www.facebook.com/chefduo.bagumbayan" className="social-link" aria-label="Facebook">
              <FaFacebook />
            </a>
          
          </div>
        </div>

        {/* Column 2: Quick Links */}
        <div className="footer-column">
          <h4 className="footer-heading">Quick Links</h4>
          <ul className="footer-links">
            <li><Link to="/">Home</Link></li>
            <li><Link to="/dashboard">Dashboard</Link></li>
            <li><Link to="/analytics">Analytics</Link></li>
            <li><Link to="/data-management">Data Management</Link></li>
          </ul>
        </div>

        {/* Column 3: Support */}
       

        {/* Column 4: Contact */}
        <div className="footer-column">
          <h4 className="footer-heading">Contact</h4>
          <ul className="footer-contact">
            <li>
              <FaMapMarkerAlt className="contact-icon" />
              <span>94 San Roque St. Bagumbayan, QC</span>
            </li>
            <li>
              <FaPhone className="contact-icon" />
              <span>0976 299 8368</span>
            </li>
            <li>
              <FaEnvelope className="contact-icon" />
              <span>chefduo@example.com</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="footer-bottom">
        <div className="footer-bottom-container">
          <p className="footer-copyright">
            &copy; {currentYear} Chef Duo. All rights reserved.
          </p>
          <div className="footer-bottom-links">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/cookies">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;