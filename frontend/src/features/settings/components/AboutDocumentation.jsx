// AboutDocumentation.jsx
import { useState, useEffect } from "react";
import { 
  FiPhone, 
  FiMail, 
  FiDownload, 
  FiBookOpen, 
  FiUsers,
  FiX,
  FiFileText
} from "react-icons/fi";
import axios from 'axios';
import toast from 'react-hot-toast';
import "./AboutDocumentation.css";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function AboutDocumentation() {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [systemInfo, setSystemInfo] = useState({
    version: "v1.0.0",
    name: "ChefDuo Demand Forecasting",
    description: "A comprehensive demand  forecasting system for restaurants and food businesses."
  });
  const [developers, setDevelopers] = useState([
    { name: "Bitancor,", title: "Jerimiah A.", avatar: null, role: "Team Lead Developer" },
    { name: "Castillon,", title: "Bianca Rain C.", avatar: null, role: "Front and Backend Developer" },
    { name: "Flavier,", title: "Laurence James L.", avatar: null, role: "Front and Backend Developer" },
  ]);

  const [documentation, setDocumentation] = useState([
    { 
      id: 1, 
      title: "User Manual", 
      description: "Complete guide on how to use the system",
      content: `
        <h2>User Manual</h2>
        <h3>Getting Started</h3>
        <p>Welcome to ChefDuo Demand Forecasting System. This guide will help you navigate through the system.</p>
        
        <h4>1. Dashboard Overview</h4>
        <p>The dashboard provides you with a comprehensive overview of your demand data, including:</p>
        <ul>
          <li>Total sales revenue</li>
          <li>Top selling products</li>
          <li>Sales trends and patterns</li>
          <li>Inventory alerts</li>
        </ul>
        
        <h4>2. Data Management</h4>
        <p>Upload and manage your sales data:</p>
        <ul>
          <li>Import CSV or Excel files</li>
          <li>Validate data before processing</li>
          <li>View upload history</li>
          <li>Export processed data</li>
        </ul>
        
        <h4>3. Forecasting</h4>
        <p>Generate accurate sales forecasts:</p>
        <ul>
          <li>Configure forecasting parameters</li>
          <li>View predictions and trends</li>
          <li>Analyze seasonal patterns</li>
        </ul>
        
        <h4>4. Reports</h4>
        <p>Generate comprehensive reports:</p>
        <ul>
          <li>Sales performance reports</li>
          <li>Product performance analysis</li>
          <li>Ingredient demand forecasting</li>
        </ul>
      `
    },
    { 
      id: 2, 
      title: "Installation Guide", 
      description: "Step-by-step installation instructions",
      content: `
        <h2>Installation Guide</h2>
        <h3>System Requirements</h3>
        <ul>
          <li>Node.js 18.x or higher</li>
          <li>PostgreSQL 14.x or higher</li>
          <li>React 18.x or higher</li>
          <li>4GB RAM minimum (8GB recommended)</li>
        </ul>
        
        <h4>1. Clone the Repository</h4>
        <pre>git clone https://github.com/your-repo/chefduo-forecasting.git</pre>
        
        <h4>2. Install Dependencies</h4>
        <pre>cd chefduo-forecasting<br>npm install</pre>
        
        <h4>3. Configure Environment</h4>
        <p>Create a .env file in the root directory with the following variables:</p>
        <pre>NODE_ENV=production<br>PORT=5000<br>SUPABASE_URL=your_supabase_url<br>SUPABASE_ANON_KEY=your_anon_key<br>JWT_SECRET=your_jwt_secret</pre>
        
        <h4>4. Database Setup</h4>
        <p>Run database migrations:</p>
        <pre>npm run migrate</pre>
        
        <h4>5. Start the Application</h4>
        <pre>npm start</pre>
        
        <p>The application will be available at: <strong>http://localhost:5000</strong></p>
      `
    },
    { 
      id: 3, 
      title: "System Documentation", 
      description: "Technical documentation for developers",
      content: `
        <h2>System Documentation</h2>
        <h3>Architecture Overview</h3>
        <p>The ChefDuo Demand Forecasting System follows a modern microservices architecture with the following components:</p>
        
        <h4>Frontend (React)</h4>
        <ul>
          <li>React with Hooks for state management</li>
          <li>React Router for navigation</li>
          <li>Axios for API communication</li>
          <li>React Hot Toast for notifications</li>
        </ul>
        
        <h4>Backend (Node.js + Express)</h4>
        <ul>
          <li>RESTful API architecture</li>
          <li>JWT authentication</li>
          <li>Multer for file uploads</li>
          <li>XLSX and CSV parsing</li>
        </ul>
        
        <h4>Database (Supabase/PostgreSQL)</h4>
        <ul>
          <li>Products table</li>
          <li>Ingredients table</li>
          <li>Product-Ingredients relationships</li>
          <li>Uploads history</li>
        </ul>
        
        <h4>API Endpoints</h4>
        <pre>
        GET    /api/health
        POST   /api/auth/login
        POST   /api/auth/register
        POST   /api/upload
        GET    /api/upload
        GET    /api/mapping/products
        POST   /api/mapping/products
        </pre>
      `
    },
    { 
      id: 4, 
      title: "API Reference", 
      description: "Complete API documentation for integration",
      content: `
        <h2>API Reference</h2>
        <h3>Authentication</h3>
        <p>All API endpoints require authentication using JWT tokens.</p>
        
        <h4>Login</h4>
        <pre><strong>POST /api/auth/login</strong>
        {
          "email": "user@example.com",
          "password": "password123"
        }
        
        Response:
        {
          "success": true,
          "token": "jwt_token_here",
          "user": {
            "id": 1,
            "name": "John Doe",
            "email": "user@example.com"
          }
        }</pre>
        
        <h4>Upload Sales Data</h4>
        <pre><strong>POST /api/upload</strong>
        Headers:
        Authorization: Bearer {token}
        Content-Type: multipart/form-data
        
        Body:
        file: (binary)
        fileType: "sales"</pre>
        
        <h4>Get Products</h4>
        <pre><strong>GET /api/mapping/products</strong>
        Headers:
        Authorization: Bearer {token}
        
        Response:
        {
          "success": true,
          "data": [
            {
              "id": 1,
              "name": "Product Name",
              "price": 99.99,
              "category": "Category",
              "ingredients": [...]
            }
          ]
        }</pre>
        
        <h4>Error Responses</h4>
        <p>All errors follow this format:</p>
        <pre>
        {
          "success": false,
          "error": "Error message",
          "details": "Additional error details"
        }</pre>
      `
    },
  ]);

  // Get auth token
  const getAuthToken = () => {
    return localStorage.getItem('token');
  };

  // Axios instance
  const apiClient = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    }
  });

  apiClient.interceptors.request.use(
    (config) => {
      const token = getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Fetch system info
  const fetchSystemInfo = async () => {
    try {
      setLoading(true);
      setSystemInfo({
        version: "v1.0.0",
        name: "ChefDuo Demand Forecasting",
        description: "A comprehensive demand forecasting system for restaurants and food businesses."
      });
    } catch (error) {
      console.error('Error fetching system info:', error);
      toast.error('Failed to load system information');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemInfo();
  }, []);

  // Handle document open/view
  const handleViewDocument = (doc, index) => {
    setSelectedDoc(index);
    setModalContent(doc);
    setIsModalOpen(true);
  };

  // Handle document download
  const handleDownloadDoc = (doc) => {
    toast.success(`Downloading ${doc.title}...`);
  };

  // Handle contact click
  const handleContact = (type) => {
    if (type === 'phone') {
      window.location.href = 'tel:+639123456789';
    } else if (type === 'email') {
      window.location.href = 'mailto:BCFsupport@system.com';
    }
  };

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false);
    setModalContent(null);
  };

  // Developer avatar colors
  const avatarColors = ['#7A0101', '#A52A2A', '#8B0000'];

  

  return (
    <div className="about-documentation-container">
      {/* Header Section */}
      <div className="header-section">
        <div className="title-section">
          <h1 className="main-title">{systemInfo.name}</h1>
          <p className="description">
            {systemInfo.description}
          </p>
          <div className="version-badge">
            <span className="version">{systemInfo.version}</span>
            <span className="status-badge">Active</span>
          </div>
        </div>

        <div className="developers-section">
          <h3 className="section-title">
            <FiUsers className="section-icon" /> Developers
          </h3>
          <div className="developers-grid">
            {developers.map((dev, index) => (
              <div key={index} className="developer-card">
                <div 
                  className="developer-avatar" 
                  style={{ 
                    backgroundColor: avatarColors[index % avatarColors.length],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: '20px',
                    fontWeight: 'bold'
                  }}
                >
                  {dev.title.charAt(0)}
                </div>
                <p className="developer-name">{dev.name} {dev.title}</p>
                <p className="developer-role">{dev.role}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Documentation Section */}
      <div className="documentation-section">
        <h3 className="section-title">
          <FiBookOpen className="section-icon" /> Documentation
        </h3>
        <div className="documentation-grid">
          {documentation.map((doc, index) => (
            <div
              key={doc.id}
              className={`documentation-card ${selectedDoc === index ? 'active' : ''}`}
              onClick={() => handleViewDocument(doc, index)}
            >
              <div className="card-icon"></div>
              <p className="card-title">{doc.title}</p>
              <p className="card-description">{doc.description}</p>
              <div className="card-footer">
                <button 
                  className="card-btn view-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewDocument(doc, index);
                  }}
                >
                  <FiFileText size={14} /> View Guide
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contact Section */}
      <div className="contact-section">
        <h3 className="section-title">Contact Information</h3>
        <div className="contact-info">
          <div className="contact-item" onClick={() => handleContact('phone')}>
            <FiPhone className="contact-icon" />
            <p>Contact No.: +639123456789</p>
          </div>
          <div className="contact-item" onClick={() => handleContact('email')}>
            <FiMail className="contact-icon" />
            <p>Email: BCFsupport@system.com</p>
          </div>
        </div>
      </div>

      {/* Modal for Document View - Rectangle with Scroll */}
      {isModalOpen && modalContent && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content-rectangle" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-rectangle">
              <div className="modal-title-rectangle">
                <div>
                  <h2 className="modal-title-text">{modalContent.title}</h2>
                  <span className="modal-subtitle">Documentation Guide</span>
                </div>
              </div>
              <button className="modal-close-rectangle" onClick={closeModal}>
                <FiX size={28} />
              </button>
            </div>

            <div className="modal-body-rectangle">
              <div className="modal-content-body-rectangle">
                <div dangerouslySetInnerHTML={{ __html: modalContent.content }} />
              </div>
            </div>

            <div className="modal-footer-rectangle">
              <button className="btn-secondary-rectangle" onClick={closeModal}>
                Close
              </button>
              <button 
                className="btn-primary-rectangle" 
                onClick={() => {
                  handleDownloadDoc(modalContent);
                }}
              >
                <FiDownload size={18} /> Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AboutDocumentation;