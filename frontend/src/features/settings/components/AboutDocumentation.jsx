// AboutDocumentation.jsx
import { useState, useEffect, useCallback } from "react";
import {
  FiPhone,
  FiMail,
  FiDownload,
  FiBookOpen,
  FiUsers,
  FiX,
  FiFileText,
  FiCheckCircle,
  FiInfo,
} from "react-icons/fi";
import "./AboutDocumentation.css";

const SYSTEM_INFO = {
  version: "v1.0.0",
  name: "ChefDuo Demand Forecasting",
  description:
    "A comprehensive demand forecasting system for restaurants and food businesses - upload your sales, forecast demand, and turn it into a ready-to-buy ingredient list.",
};

const DEVELOPERS = [
  { id: 1, name: "Jerimiah A. Bitancor", role: "Team Lead Developer" },
  { id: 2, name: "Bianca Rain C. Castillon", role: "Frontend & Backend Developer" },
  { id: 3, name: "Laurence James L. Flavier", role: "Frontend & Backend Developer" },
];

const CONTACTS = [
  { id: "phone", icon: FiPhone, label: "Contact No.", value: "+63 912 345 6789", href: "tel:+639123456789" },
  { id: "email", icon: FiMail, label: "Email", value: "BCFsupport@system.com", href: "mailto:BCFsupport@system.com" },
];

const USER_MANUAL = {
  title: "User Manual",
  description: "A complete guide to using the system, from creating your account to downloading your grocery list.",
  content: `
    <h2>User Manual</h2>
    <p>Welcome to the ChefDuo Demand Forecasting System. This manual explains every part of the application, from creating your account and uploading sales data to reading your forecasts and downloading a grocery list. Use it as a step-by-step guide or as a reference.</p>

    <h3>1. Getting Started</h3>
    <h4>Create your account</h4>
    <ul>
      <li>On the registration page, enter your <strong>Full Name</strong> and <strong>Email</strong> and accept the terms.</li>
      <li>A one-time code (OTP) is sent to your email. Enter it on the <strong>Verify Email</strong> screen to confirm your address.</li>
      <li>On the <strong>Create Password</strong> screen, set a password. It must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.</li>
    </ul>
    <h4>Sign in</h4>
    <ul>
      <li>On the <strong>Login</strong> screen, enter your email and password.</li>
      <li>If you forget your password, choose <strong>Forgot Password</strong>, enter your email, and use the code you receive to set a new one.</li>
    </ul>
    <h4>Roles</h4>
    <p>Your role is shown in the navigation bar as <strong>Owner</strong> or <strong>Administrator</strong>. Some areas, such as Settings, are intended for owners.</p>

    <h3>2. Navigating the System</h3>
    <p>The navigation bar at the top of every page is your main way to move around the application:</p>
    <ul>
      <li><strong>Dashboard</strong> - your home screen and the current status of your data.</li>
      <li><strong>Data Management</strong> - upload sales data and review your upload history.</li>
      <li><strong>Inventory</strong> - manage ingredients, menu products, and market prices.</li>
      <li><strong>Analytics</strong> - sales forecast, product performance, and ingredient demand.</li>
      <li><strong>Settings</strong> - business profile, account, forecast configuration, and more.</li>
      <li><strong>Notification bell</strong> - alerts about uploads, training, and forecasts.</li>
      <li><strong>Help</strong> - a quick reference for how the modules work.</li>
      <li><strong>Profile</strong> - shows your role and the <strong>Logout</strong> option.</li>
    </ul>

    <h3>3. The Dashboard</h3>
    <p>The Dashboard adapts to the state of your data, so it always shows the next action to take. It refreshes automatically. Depending on your uploaded history and model training, you will see one of the following screens.</p>
    <h4>Nothing uploaded yet</h4>
    <ul>
      <li>Two setup steps are shown: <strong>Upload Historical Sales Data</strong> and <strong>Add Ingredient Recipes to Your Products</strong>.</li>
      <li>The buttons <strong>Upload Sales Data</strong> and <strong>Go to Inventory Management</strong> take you straight to the task.</li>
      <li>At least <strong>12+ months</strong> of sales history is recommended so the model can learn seasonal patterns.</li>
    </ul>
    <h4>Sales data uploaded, history not complete</h4>
    <ul>
      <li>A meter shows how much of your sales history is covered. Dates that genuinely had no sales can be marked as <strong>closed</strong> so they do not count against your history.</li>
      <li>Forecasting begins once your history clears the 12-month rule.</li>
    </ul>
    <h4>Your data is ready to train</h4>
    <ul>
      <li>Select <strong>Start Training</strong> and confirm. Training runs on the server.</li>
    </ul>
    <h4>Model training in progress</h4>
    <ul>
      <li>A progress meter shows that the model is still training. You can upload more data or manage inventory while you wait.</li>
    </ul>
    <h4>Forecasts are ready, recipes still pending</h4>
    <ul>
      <li>Tiles summarise <strong>Active products</strong>, <strong>With recipes</strong>, and <strong>Still missing</strong>. Add the missing recipes under Inventory so every product can be forecast.</li>
      <li>The buttons <strong>View Full Forecast</strong> and <strong>Product Performance</strong> open the analytics.</li>
    </ul>
    <h4>Your forecasts need your attention</h4>
    <ul>
      <li>Issue cards flag problems such as <strong>Stale Sales Data</strong>, <strong>Model Needs Retraining</strong>, <strong>Low Forecast Accuracy</strong>, and <strong>Data Quality Issue</strong>, each with a suggested action such as <strong>Upload Sales Data</strong> or <strong>Retrain Model</strong>.</li>
    </ul>
    <h4>Fully operational</h4>
    <ul>
      <li>Key metrics: <strong>Predicted Sales Tomorrow</strong>, <strong>Actual Sales Yesterday</strong>, <strong>Forecast Accuracy</strong>, and a <strong>Stock Alert</strong> breakdown (Critical, Low, Normal, Excess).</li>
      <li>A <strong>Demand Overview</strong> chart with Line and Bar views over the <strong>Last 7 Days</strong> or <strong>Last 30 Days</strong>.</li>
      <li><strong>Top Best Sellers</strong> and <strong>Top Ingredients to Prepare</strong>.</li>
    </ul>
    <p>If the server cannot be reached, a <strong>Connection Problem</strong> card appears with a <strong>Retry</strong> button.</p>

    <h3>4. Data Management</h3>
    <p>Open <strong>Data Management</strong> to upload the sales data the system learns from. The page has two tabs and two summary cards: <strong>Sales Records</strong> (the total number of rows) and <strong>Last Sync</strong>.</p>
    <h4>Sales Data Upload</h4>
    <ul>
      <li>Drag and drop a file onto the upload area, or click to browse. <strong>CSV and XLSX</strong> files are supported.</li>
      <li>Each file shows a status: <strong>Ready</strong>, <strong>Uploading...</strong>, <strong>Complete!</strong>, <strong>Already uploaded</strong>, or <strong>Failed</strong>, with a progress bar.</li>
      <li>You can queue several files at once; they upload in a batch. A file that has already been imported is detected and skipped.</li>
    </ul>
    <h4>Historical Data Storage</h4>
    <ul>
      <li>A table lists every past upload: <strong>No.</strong>, <strong>Upload Date</strong>, <strong>File Name</strong>, <strong>Records</strong>, <strong>Status</strong>, and an <strong>Action</strong> to download the original file.</li>
      <li>Use the search box and the sort menu (Newest/Oldest, File Name A-Z/Z-A, Records High/Low) to find a file, and use pagination to move through the list.</li>
    </ul>

    <h3>5. Inventory Management</h3>
    <p>Open <strong>Inventory</strong> to keep your ingredients, menu products, and market prices up to date. It has three tabs: <strong>Ingredient Management</strong>, <strong>Product Management</strong>, and <strong>Market Price</strong>.</p>
    <h4>Ingredient Management</h4>
    <ul>
      <li>Lists every ingredient with its <strong>Unit</strong>, <strong>Category</strong>, <strong>Current Stock</strong>, <strong>Unit Cost</strong>, <strong>Average Market Price</strong>, <strong>Last Updated</strong>, and a colour-coded <strong>Status</strong> (Critical, Low, Normal, Excess, or Not Tracked).</li>
      <li>Use the search box and the <strong>Sort By</strong> menu to find items, and tick rows to <strong>Archive Selected</strong>.</li>
      <li>Select <strong>Add New Item</strong> to create an ingredient. Use the row actions to <strong>Edit</strong>, <strong>Add Stock</strong> (restock), <strong>View History</strong> (a log of every stock change), or <strong>Archive</strong> an item.</li>
    </ul>
    <h4>Product Management</h4>
    <ul>
      <li>Summary cards show <strong>Total Menu Items</strong>, <strong>Average COGS</strong>, <strong>High Food Cost Items</strong>, and <strong>Unmapped Products</strong> (products still missing a recipe).</li>
      <li>Each product lists its <strong>Category</strong>, <strong>Modifier</strong>, <strong>Ingredients</strong>, <strong>Selling Price</strong>, <strong>Total Ingredient Cost</strong>, and <strong>Status</strong>.</li>
      <li>Add a product with <strong>Add Product</strong>. In the product form, add each ingredient as a line with its <strong>Quantity</strong> and <strong>Unit</strong>; the ingredient cost is calculated automatically.</li>
      <li>Products are classified as <strong>Active</strong>, <strong>New</strong> (needs 4 weeks of data before forecasts activate), <strong>Inactive</strong> (auto-flagged after 28 days with no sales), or <strong>Archived</strong>. Archived products can be restored.</li>
      <li>The <strong>High Food Cost</strong> modal shows each item's food-cost percentage and profit margin. Note that a high food cost does not always mean the item is unprofitable.</li>
    </ul>
    <h4>Market Price</h4>
    <ul>
      <li>Compare ingredient prices across suppliers. Cards show <strong>Cheapest Source</strong>, <strong>Average Price</strong>, <strong>Potential Savings</strong>, and <strong>Last Updated</strong>.</li>
      <li>The table lists each ingredient per source (Robinson's, SM, Puregold, <strong>Wet Market</strong>, and <strong>DA Reference</strong>), along with the <strong>Lowest</strong> price and <strong>Savings vs Your Price</strong>.</li>
      <li>Use <strong>Add Price Entry</strong> to record a price, <strong>Manage Sources</strong> to add suppliers (Wet Market and DA Reference are required and cannot be removed), and <strong>Export CSV</strong> to download the table.</li>
      <li>The <strong>DA Reference</strong> column is filled automatically every day from the Department of Agriculture Daily Price Index (Bantay Presyo). Select <strong>View price trend</strong> on a row to chart a price over time.</li>
    </ul>

    <h3>6. Analytics</h3>
    <p>Open <strong>Analytics</strong> for a deeper analysis of your data. Three tabs sit across the top: <strong>Forecasting</strong>, <strong>Product Performance</strong>, and <strong>Ingredient Demand</strong>. Each tab has a <strong>Generate Report</strong> button to export the current view.</p>
    <h4>Sales Forecast</h4>
    <ul>
      <li>Select <strong>Generate Forecast</strong> to create fresh predictions. Forecasts also run automatically: daily at <strong>9:00 AM</strong> every day except Monday, and a 7-day forecast every <strong>Monday at 9:00 AM</strong> (Monday runs the 7-day forecast only).</li>
      <li>The <strong>Forecast Accuracy</strong> card compares your forecast against a simple 7-day average. A higher percentage means the model is beating that baseline.</li>
      <li><strong>Sales and Demand Prediction</strong> shows a line chart and a table with <strong>Actual</strong> and <strong>Forecast</strong> quantities and revenue, plus estimated cost and gross profit. Switch between the <strong>Sales</strong> and <strong>Demand</strong> views and choose a date range.</li>
      <li><strong>Model Insights</strong> lists <strong>Feature Importance</strong> (what influences sales the most) and <strong>Training Information</strong> such as model status, last trained, active products, latest forecast, and the next training and forecast dates.</li>
    </ul>
    <h4>Product Performance</h4>
    <ul>
      <li><strong>Demand Classification</strong> groups tomorrow's forecast per product into <strong>Low</strong>, <strong>Medium</strong>, and <strong>High</strong> demand zones, each with an action signal.</li>
      <li><strong>Product Performance Ratio Analysis</strong> ranks products against your store average (1.0). Ratios above 1.0 are outperforming; ratios below 1.0 are underperforming. Use <strong>Last 7 Days</strong> for a quick recent view.</li>
      <li><strong>Product Status</strong> groups products as Active, New, Inactive, or Archived so you can see what is selling and what needs attention.</li>
    </ul>
    <h4>Ingredient Demand</h4>
    <ul>
      <li><strong>Weekly Ingredient Demand</strong> is a heatmap of how much of each ingredient you need, Monday to Sunday. Darker cells mean higher demand than that ingredient's usual amount (Normal, Above Normal, or High Demand Day).</li>
      <li><strong>Daily Ingredient Demand</strong> shows today's needs based on predicted sales and current stock: <strong>Forecasted Need</strong>, <strong>On Stock</strong>, <strong>Status</strong>, <strong>To Buy</strong>, <strong>Unit</strong>, <strong>Market Price</strong>, and <strong>Est. Cost</strong>. Status runs from <strong>Excess</strong> (delay restock) through <strong>Normal</strong> and <strong>Low</strong> (order soon) to <strong>Critical</strong> (order now).</li>
    </ul>

    <h3>7. The Grocery List</h3>
    <p>The <strong>Grocery List</strong> card on the Ingredient Demand tab turns the forecast into a shopping list.</p>
    <ul>
      <li>Toggle between <strong>Weekly</strong> and <strong>Daily</strong>; the date label updates accordingly.</li>
      <li>Quantities are the forecasted demand (plus a safety buffer) minus your current stock, so you only buy what you still need.</li>
      <li>Cards show the <strong>Est. Total Cost</strong> and the <strong>Total Items to Buy</strong>, and the first few items are previewed.</li>
      <li>Select <strong>View Full List</strong> to see everything grouped by category (Item, Qty, Unit, Market Price, Notes), or <strong>Download</strong> to save the list as a PDF for printing.</li>
    </ul>

    <h3>8. Settings</h3>
    <p>Open <strong>Settings</strong> to configure the system. It is organised into tabs.</p>
    <h4>Business Profile</h4>
    <ul>
      <li>Enter your restaurant's name, address, email, and contact number, and upload a <strong>logo</strong> by dragging and dropping it.</li>
      <li>Set your opening and closing times and your operating days.</li>
    </ul>
    <h4>Account Settings</h4>
    <ul>
      <li>Update your account email. Changing it requires a one-time code sent to the new address (you can resend after 60 seconds).</li>
    </ul>
    <h4>Forecast Configuration</h4>
    <ul>
      <li>Set the <strong>days to forecast</strong>, the <strong>food cost warning threshold</strong>, and the <strong>stock thresholds</strong> for Critical, Low, and Excess. These control the alerts and classifications shown elsewhere in the system.</li>
    </ul>
    <h4>Data Management Settings</h4>
    <ul>
      <li>Manage how uploaded data is handled and other related options.</li>
    </ul>
    <h4>Audit Logs</h4>
    <ul>
      <li>A searchable, filterable record of the actions performed in the system.</li>
    </ul>
    <h4>About &amp; Documentation</h4>
    <ul>
      <li>Shows the system version and developers, the contact details, and this User Manual.</li>
    </ul>

    <h3>9. Notifications</h3>
    <ul>
      <li>The <strong>bell</strong> in the navigation bar shows a badge when you have unread notifications, and new ones slide in as a pop-out on the right.</li>
      <li>Open the bell to read recent items, <strong>Mark all as read</strong>, or <strong>Clear all</strong>. Select <strong>View all notifications</strong> to open the full page.</li>
      <li>On the <strong>Notifications</strong> page you can filter by <strong>All</strong>, <strong>Unread</strong>, or <strong>Read</strong>, refresh the list, and page through older notifications.</li>
    </ul>

    <h3>10. Tips and Troubleshooting</h3>
    <ul>
      <li>Upload as much history as possible - at least 12 months - for the most accurate forecasts.</li>
      <li>Keep recipes complete: products without ingredients cannot be broken down into ingredient demand.</li>
      <li>If forecasts look inaccurate, retrain the model after adding new data and check the Model Insights card.</li>
      <li>If your data has not changed for a while, the Dashboard will suggest uploading fresh sales data.</li>
      <li>If you see a Connection Problem, check your internet connection and select <strong>Retry</strong>.</li>
    </ul>

    <h3>11. Glossary</h3>
    <ul>
      <li><strong>COGS</strong> - Cost of Goods Sold; the total ingredient cost of a product.</li>
      <li><strong>Forecast Accuracy</strong> - how closely predictions matched actual sales, compared with a simple 7-day average.</li>
      <li><strong>Safety Buffer</strong> - extra quantity added to forecasted demand so you do not run short.</li>
      <li><strong>WMAPE</strong> - the error measure behind the accuracy percentage; a lower value is better.</li>
      <li><strong>Demand Level</strong> - the colour-coded signal such as Critical, Low, Normal, or Excess (ingredients) or Low, Medium, or High (products).</li>
    </ul>
  `,
};

function AboutDocumentation() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isModalOpen, closeModal]);

  const handlePrintManual = () => {
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${USER_MANUAL.title}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2937; line-height: 1.7; padding: 40px; max-width: 820px; margin: 0 auto; }
            h2 { color: #7a0101; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 3px solid #f3dcdc; }
            h3 { color: #1f2937; margin: 24px 0 10px; }
            h4 { color: #1f2937; margin: 18px 0 8px; }
            ul { padding-left: 24px; margin: 8px 0 16px; }
            li { margin: 4px 0; }
            p { margin: 8px 0; }
          </style>
        </head>
        <body>${USER_MANUAL.content}</body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="about-documentation-container">
      <div className="ad-top-grid">
        {/* About the system */}
        <section className="ad-card ad-about-card">
          <div className="ad-card-header">
            <span className="ad-card-icon"><FiInfo size={16} /></span>
            <h3 className="ad-card-title">About the System</h3>
          </div>
          <h1 className="ad-system-name">{SYSTEM_INFO.name}</h1>
          <p className="ad-system-description">{SYSTEM_INFO.description}</p>
          <div className="ad-badges">
            <span className="ad-badge ad-badge--version">{SYSTEM_INFO.version}</span>
            <span className="ad-badge ad-badge--active"><FiCheckCircle size={13} /> Active</span>
          </div>
        </section>

        {/* Developers */}
        <section className="ad-card ad-developers-card">
          <div className="ad-card-header">
            <span className="ad-card-icon"><FiUsers size={16} /></span>
            <h3 className="ad-card-title">Developers</h3>
          </div>
          <ul className="ad-developers-list">
            {DEVELOPERS.map((dev) => (
              <li key={dev.id} className="ad-developer-item">
                <span className="ad-developer-avatar">{dev.name.charAt(0)}</span>
                <span className="ad-developer-text">
                  <span className="ad-developer-name">{dev.name}</span>
                  <span className="ad-developer-role">{dev.role}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Documentation - User Manual only */}
      <section className="ad-card ad-docs-card">
        <div className="ad-card-header">
          <span className="ad-card-icon"><FiBookOpen size={16} /></span>
          <h3 className="ad-card-title">Documentation</h3>
        </div>
        <div className="ad-doc-row">
          <span className="ad-doc-file-icon"><FiFileText size={22} /></span>
          <div className="ad-doc-text">
            <p className="ad-doc-title">{USER_MANUAL.title}</p>
            <p className="ad-doc-description">{USER_MANUAL.description}</p>
          </div>
          <button type="button" className="ad-btn ad-btn--primary" onClick={() => setIsModalOpen(true)}>
            <FiFileText size={15} /> View Manual
          </button>
        </div>
      </section>

      {/* Contact */}
      <section className="ad-card ad-contact-card">
        <div className="ad-card-header">
          <span className="ad-card-icon"><FiPhone size={16} /></span>
          <h3 className="ad-card-title">Contact Information</h3>
        </div>
        <div className="ad-contact-grid">
          {CONTACTS.map(({ id, icon: Icon, label, value, href }) => (
            <a key={id} className="ad-contact-item" href={href}>
              <span className="ad-contact-icon"><Icon size={18} /></span>
              <span className="ad-contact-text">
                <span className="ad-contact-label">{label}</span>
                <span className="ad-contact-value">{value}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* User Manual modal */}
      {isModalOpen && (
        <div className="ad-modal-overlay" onClick={closeModal}>
          <div
            className="ad-modal"
            role="dialog"
            aria-modal="true"
            aria-label={USER_MANUAL.title}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ad-modal-header">
              <div className="ad-modal-heading">
                <span className="ad-modal-icon"><FiBookOpen size={20} /></span>
                <div>
                  <h2 className="ad-modal-title">{USER_MANUAL.title}</h2>
                  <span className="ad-modal-subtitle">Documentation Guide</span>
                </div>
              </div>
              <button type="button" className="ad-modal-close" onClick={closeModal} aria-label="Close">
                <FiX size={22} />
              </button>
            </header>

            <div className="ad-modal-body">
              <div className="ad-modal-content" dangerouslySetInnerHTML={{ __html: USER_MANUAL.content }} />
            </div>

            <footer className="ad-modal-footer">
              <button type="button" className="ad-btn ad-btn--ghost" onClick={closeModal}>
                Close
              </button>
              <button type="button" className="ad-btn ad-btn--primary" onClick={handlePrintManual}>
                <FiDownload size={16} /> Download PDF
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default AboutDocumentation;
