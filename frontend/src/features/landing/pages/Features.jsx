// frontend/src/features/landing/pages/Features.jsx
import { Link } from 'react-router-dom';
import {
  FaChartLine,
  FaChartBar,
  FaBoxes,
  FaClipboardList,
  FaDatabase,
  FaSlidersH,
  FaCheck,
  FaTimes,
  FaBan,
  FaFileAlt,
  FaBell,
  FaLock,
  FaArrowRight,
} from 'react-icons/fa';

import LandingNav from '../landing-kit/LandingNav';
import LandingFooter from '../landing-kit/LandingFooter';
import useReveal from '../landing-kit/useReveal';
import '../landing-kit/landing-kit.css';

import dashboardImg from '../../../assets/landing/Dashboard.png';
import analyticsImg from '../../../assets/landing/Analytics.png';
import inventoryImg from '../../../assets/landing/Inventory.png';
import inventoryImg2 from '../../../assets/landing/Inventory2.png';

import dataMgmtImg from '../../../assets/landing/DataManagement.png';

const MODULES = [
  {
    id: 'forecasting',
    icon: <FaChartLine />,
    tone: '',
    title: 'Demand Forecasting',
    lead: 'Predictable product demand from your own history.',
    text: 'Upload historical sales records and ChefDuo Forecast trains a gradient-boosted model on them, then generates daily and weekly projections for every product. Weekday, weekend, seasonal, and payday-related patterns are picked up automatically instead of being hand-coded.',
    bullets: [
      'Daily and weekly demand projections',
      'Model trained on your sales history, not generic averages',
      'Forecast generation you can run on demand',
      'Exportable forecast reports',
    ],
    img: dashboardImg,
    alt: 'Demand forecasting dashboard with daily and weekly projections',
    span: 3,
  },
  {
    id: 'performance',
    icon: <FaChartBar />,
    tone: 'lk-card-ico--amber',
    title: 'Product Performance',
    lead: 'Know which items actually move.',
    text: 'Products are classified by demand level and evaluated against your own sales patterns. This separates genuine bestsellers from items that look important on the menu but quietly tie up stock and shelf space.',
    bullets: [
      'Demand-level classification per product',
      'Comparison against your own sales history',
      'Performance grouped by category',
      'Clear flags for under- and over-performers',
    ],
    img: analyticsImg,
    alt: 'Product performance breakdown grouped by demand level',
    span: 3,
  },
  {
    id: 'ingredients',
    icon: <FaBoxes />,
    tone: 'lk-card-ico--green',
    title: 'Ingredient Management',
    lead: 'Your stock, measured against what the forecast needs.',
    text: 'Record every ingredient you track with its quantity, unit, price, and minimum stock level, and log restocks as they come in. Each item is then measured against the demand forecast for that day, so anything running short — or sitting far above what you need — is flagged before it turns into a stockout or wasted capital.',
    bullets: [
      'Stock records with quantity, unit, price, and minimum level',
      'Restock logging with per-item movement history',
      'Stock measured against the daily forecasted need',
      'Shortage and excess alerts with configurable thresholds',
    ],
        img: inventoryImg2,
    alt: 'Ingredient management screen with stock levels and projected need',

    span: 3,
  },
  {
    id: 'product-management',
    icon: <FaClipboardList />,
    tone: 'lk-card-ico--ink',
    title: 'Product Management',
    lead: 'Your menu, recipes, and margins in one place.',
    text: 'Products are pulled in from your uploaded sales data, and each one can be mapped to a recipe listing the ingredients and quantities it takes to make a serving. Cost of goods and food cost percentage are then calculated against your recorded ingredient prices, so you can see which items are genuinely worth keeping on the menu.',
    bullets: [
      'Menu catalog built from your uploaded sales history',
      'Per-serving ingredient recipes with quantity and unit',
      'Automatic COGS and food cost percentage per item',
      'Archive and restore with 28-day activity-based status',
    ],
    img: inventoryImg,
    alt: 'Product management screen listing menu items with recipes and stock levels',
    span: 3,
  },
  {
    id: 'data',
    icon: <FaDatabase />,
    tone: '',
    title: 'Data Management',
    lead: 'Keep the training data trustworthy.',
    text: 'Every forecast is only as good as the history behind it. Upload CSV or XLSX sales exports, review what was accepted, archive periods you no longer need, and retrain against a dataset you can actually stand behind.',
    bullets: [
      'CSV and XLSX sales-history uploads',
      'Per-upload review with row-level validation',
      'Archive and restore of historical periods',
      'Retraining triggered on new uploads',
    ],
    img: dataMgmtImg,
    alt: 'Data management screen for uploading and reviewing sales history',
    span: 6,
    split: true,
  },
];

const PLATFORM = [
  {
    icon: <FaSlidersH />,
    title: 'Forecast Configuration',
    text: 'Tune horizon, retraining cadence, and forecast parameters to match how your business actually runs.',
  },
  {
    icon: <FaBell />,
    title: 'Notifications',
    text: 'Get alerted when forecasts are ready and when ingredients fall short of projected need.',
  },
  {
    icon: <FaLock />,
    title: 'Privacy & Security',
    text: 'Your business data stays in your account, handled under the Data Privacy Act of 2012.',
  },
  {
    icon: <FaFileAlt />,
    title: 'Exportable Reports',
    text: 'Generate PDF and spreadsheet reports for forecasts, performance, and ingredient needs.',
  },
];

const Features = () => {
  useReveal();

  return (
    <div className="lk-root" id="top">
      <a className="lk-skip" href="#main">
        Skip to content
      </a>
      <LandingNav />

      <main id="main">
        <section className="lk-pagehead">
          <div className="lk-container">
            <div className="lk-crumbs">
              <Link to="/">Home</Link>
              <FaArrowRight size={11} />
              <span>Features</span>
            </div>
            <h1 className="lk-pagehead-title">
              Everything you need to plan from data
            </h1>
            <p className="lk-pagehead-sub">
              Five core modules turn sales history into forecasts, ingredient
              requirements, and a clear view of what needs restocking — plus the
              platform features that keep them current.
            </p>
          </div>
        </section>

        <section className="lk-section lk-section--white">
          <div className="lk-container">
            <div className="lk-bento">
              {MODULES.map((m) => {
                const shot = m.img ? (
                  <div className="lk-card-shot">
                    <img src={m.img} alt={m.alt} loading="lazy" />
                  </div>
                ) : null;

                return (
                  <article
                    className={`lk-card lk-card--span${m.span}${
                      m.split ? ' lk-card--split' : ''
                    } lk-reveal`}
                    key={m.id}
                    id={m.id}
                  >
                    <div className="lk-card-copy">
                      <span className={`lk-card-ico ${m.tone}`}>{m.icon}</span>
                      <h2 className="lk-card-title">{m.title}</h2>
                      <p className="lk-card-lead">{m.lead}</p>
                      <p className="lk-card-text">{m.text}</p>

                      <ul className="lk-card-bullets">
                        {m.bullets.map((b) => (
                          <li className="lk-card-bullet" key={b}>
                            {b}
                          </li>
                        ))}
                      </ul>

                      {!m.split && shot}
                    </div>
                    {m.split && shot}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lk-section lk-section--tint">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">Platform</span>
              <h2 className="lk-section-title">
                Supporting features that keep data current
              </h2>
              <p className="lk-section-sub">
                Forecasts are only as good as the data behind them. These keep
                your inputs, alerts, and exports in good shape.
              </p>
            </div>

            <div className="lk-values lk-reveal">
              {PLATFORM.map((p) => (
                <div className="lk-value" key={p.title}>
                  <div className="lk-infocard-ico">{p.icon}</div>
                  <h3 className="lk-value-title">{p.title}</h3>
                  <p className="lk-value-text">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lk-section lk-section--white" id="scope">
          <div className="lk-container">
            <div className="lk-compare lk-reveal">
              <div className="lk-compare-col lk-compare-col--yes">
                <div className="lk-compare-head">
                  <span className="lk-compare-badge">
                    <FaCheck size={14} />
                  </span>
                  <h2 className="lk-compare-title">What ChefDuo Forecast does</h2>
                </div>
                <ul className="lk-compare-list">
                  {[
                    'Generates demand forecasts from your history',
                    'Classifies products by demand level',
                    'Estimates ingredient requirements via recipes',
                    'Tracks inventory against projected need',
                    'Surfaces replenishment candidates',
                    'Produces reports and analytics',
                  ].map((s) => (
                    <li className="lk-compare-item" key={s}>
                      <FaCheck size={12} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lk-compare-col lk-compare-col--no">
                <div className="lk-compare-head">
                  <span className="lk-compare-badge">
                    <FaBan size={14} />
                  </span>
                  <h2 className="lk-compare-title">
                    Where it deliberately stops
                  </h2>
                </div>
                <ul className="lk-compare-list">
                  {[
                    'Placing orders with suppliers automatically',
                    'Managing supplier relationships',
                    'Issuing purchase orders',
                    'Arranging deliveries or logistics',
                    'Making decisions on your behalf',
                  ].map((s) => (
                    <li className="lk-compare-item" key={s}>
                      <FaTimes size={12} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="lk-callout lk-reveal">
              <FaLock size={19} />
              <p className="lk-callout-text">
                <strong>Your data stays yours.</strong> ChefDuo Forecast does not
                sell or rent your business information, and handles personal data
                in accordance with the Data Privacy Act of 2012.
              </p>
            </div>
          </div>
        </section>

        </main>

      <LandingFooter />
    </div>
  );
};

export default Features;
