import { useEffect, useRef } from 'react';
import {
  FaDatabase,
  FaBoxes,
  FaChartPie,
  FaCog,
  FaChartBar,
  FaCloudUploadAlt,
  FaCheckDouble,
  FaCogs,
  FaChartLine,
  FaShoppingBasket,
  FaTimes,
  FaArrowRight,
  FaLayerGroup,
  FaClipboardList,
  FaTags
} from 'react-icons/fa';
import './HelpModal.css';

const PIPELINE = [
  {
    icon: <FaCloudUploadAlt />,
    title: 'Upload your sales history',
    body: 'Export your sales from wherever you record them as a CSV or XLSX file and drop it into Data Management. Every row is validated before it is accepted, so bad dates or missing prices are caught up front rather than poisoning the model later.'
  },
  {
    icon: <FaCheckDouble />,
    title: 'Review and close periods',
    body: 'Uploads that are incomplete land on a Needs Attention screen instead of training silently. Mark the dates you do not want the model learning from as closed, and those rows are excluded.'
  },
  {
    icon: <FaCogs />,
    title: 'Train the model',
    body: 'Once enough usable history exists, training starts on its own. The model learns your weekday and seasonal patterns from your own numbers rather than a generic trend, which is why a consistent history beats a long one.'
  },
  {
    icon: <FaChartLine />,
    title: 'Read the forecasts',
    body: 'Forecasting shows predicted demand per product over the period you chose. This is the output everything else is built on.'
  },
  {
    icon: <FaChartBar />,
    title: 'Check product performance',
    body: 'Product Performance lines actual sales against the prediction so you can see which items the forecast is tracking well and which are drifting. Those are the products worth investigating.'
  },
  {
    icon: <FaShoppingBasket />,
    title: 'Turn demand into ingredients',
    body: 'Each forecast quantity is multiplied by the recipe quantities you defined per serving, giving a requirement for every ingredient. It is a requirement list, not a purchase order — you still decide what to order.'
  },
  {
    icon: <FaBoxes />,
    title: 'Act on your stock',
    body: 'Ingredient Management measures the stock you have recorded against what the forecast needs. Anything short or sitting far above need is flagged before it becomes a stockout or dead capital.'
  }
];

const MODULES = [
  {
    icon: <FaChartBar />,
    name: 'Dashboard',
    path: '/dashboard',
    body: 'Your starting point, and it changes shape depending on where you are. It tracks seven states: no data, insufficient data, ready to train, training, forecasts ready, needs attention, and fully operational.'
  },
  {
    icon: <FaDatabase />,
    name: 'Data Management',
    path: '/data-management',
    body: 'Where the training data comes from. Upload sales history, review what was accepted and what was rejected, archive periods you no longer need, and trigger a retrain whenever you add data.'
  },
  {
    icon: <FaBoxes />,
    name: 'Inventory',
    path: '/inventory-management',
    body: 'Three tabs covering what you buy and what you sell. This is where forecasts turn into purchasing decisions.',
    tabs: [
      {
        icon: <FaLayerGroup />,
        name: 'Ingredient Management',
        body: 'Record quantity, unit, price, and minimum level per ingredient, log restocks, and keep a per-item movement history. Each item is scored against the daily forecasted need.'
      },
      {
        icon: <FaClipboardList />,
        name: 'Product Management',
        body: 'Your menu catalog, built from uploaded sales history. Map each product to a recipe listing ingredient quantities per serving, and COGS and food cost percentage are calculated against recorded ingredient prices.'
      },
      {
        icon: <FaTags />,
        name: 'Market Price',
        body: 'Track what suppliers charge you and when it changed. These prices feed the cost calculations on your products.'
      }
    ]
  },
  {
    icon: <FaChartPie />,
    name: 'Analytics',
    path: '/analytics',
    body: 'The read-only side of the system. Everything here is derived from your data and your forecasts.',
    tabs: [
      {
        icon: <FaChartLine />,
        name: 'Forecasting',
        body: 'Predicted demand per product across the period you selected.'
      },
      {
        icon: <FaChartBar />,
        name: 'Product Performance',
        body: 'Actuals against predictions, with the revenue drivers ranked.'
      },
      {
        icon: <FaShoppingBasket />,
        name: 'Ingredient Demand',
        body: 'Recipe quantities multiplied by forecast demand, giving the ingredient requirements for the period.'
      }
    ]
  },
  {
    icon: <FaCog />,
    name: 'Settings',
    path: '/settings',
    body: 'Account and business details, your logo, the stock level thresholds that decide when an item is called low, and notification preferences.'
  }
];

const TABS = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'modules', label: 'Modules' }
];

function Pipeline() {
  return (
    <div className="help-pipeline">
      {PIPELINE.map((step, i) => (
        <div className="help-step" key={step.title}>
          <div className="help-step-rail">
            <span className="help-step-icon">{step.icon}</span>
            {i < PIPELINE.length - 1 && <span className="help-step-line" />}
          </div>
          <div className="help-step-body">
            <span className="help-step-index">Step {i + 1}</span>
            <h4>{step.title}</h4>
            <p>{step.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Modules() {
  return (
    <div className="help-modules">
      {MODULES.map((mod) => (
        <div className="help-module" key={mod.name}>
          <div className="help-module-head">
            <span className="help-module-icon">{mod.icon}</span>
            <div>
              <h4>{mod.name}</h4>
              <code className="help-module-path">{mod.path}</code>
            </div>
          </div>
          <p>{mod.body}</p>
          {mod.tabs && (
            <div className="help-subtabs">
              {mod.tabs.map((tab) => (
                <div className="help-subtab" key={tab.name}>
                  <span className="help-subtab-icon">{tab.icon}</span>
                  <div>
                    <h5>{tab.name}</h5>
                    <p>{tab.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const HelpModal = ({ activeTab, onTabChange, onClose }) => {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="help-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
      >
        <header className="help-head">
          <div>
            <h3 id="help-dialog-title">How ChefDuo Forecast works</h3>
            <p>From a sales spreadsheet to a restocking decision.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="help-close"
            onClick={onClose}
            aria-label="Close help"
          >
            <FaTimes />
          </button>
        </header>

        <nav className="help-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`help-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="help-body">
          {activeTab === 'how-it-works' ? <Pipeline /> : <Modules />}
        </div>

        <footer className="help-foot">
          <span>
            <FaArrowRight /> Start at Data Management to upload your first history.
          </span>
        </footer>
      </div>
    </div>
  );
};

export default HelpModal;