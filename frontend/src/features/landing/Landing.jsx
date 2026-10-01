// frontend/src/features/landing/Landing.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaChartLine,
  FaChartBar,
  FaBoxes,
  FaClipboardList,
  FaLayerGroup,
  FaDatabase,
  FaBolt,
  FaCheck,
  FaTimes,
  FaUpload,
  FaBrain,
  FaListOl,
  FaArrowRight,
  FaLightbulb,
  FaFileExcel,
  FaClock,
} from 'react-icons/fa';

import LandingNav from './landing-kit/LandingNav';
import LandingFooter from './landing-kit/LandingFooter';
import FaqAccordion from './landing-kit/FaqAccordion';
import { PrivacyModal, TermsModal } from './landing-kit/LegalModals';
import useReveal from './landing-kit/useReveal';
import './landing-kit/landing-kit.css';

import dashboardImg from '../../assets/landing/Dashboard.png';
import analyticsImg from '../../assets/landing/Analytics.png';
import inventoryImg from '../../assets/landing/Inventory.png';
import inventoryImg2 from '../../assets/landing/Inventory2.png';

import dataMgmtImg from '../../assets/landing/DataManagement.png';

const STATS = [
  { value: '12+', label: 'Months of history used' },
  { value: '6', label: 'Integrated modules' },
  { value: 'XGBoost', label: 'Forecasting engine' },
  { value: 'CSV / XLSX', label: 'Supported uploads' },
];

const FEATURES = [
  {
    icon: <FaChartLine />,
    tone: '',
    title: 'Demand Forecasting',
    text: 'Analyze historical sales data and generate daily and weekly product demand forecasts using gradient-boosted models.',
    tags: ['XGBoost', 'Daily + Weekly'],
    span: 3,
    img: dashboardImg,
    alt: 'Demand forecasting dashboard with daily and weekly projections',
  },
  {
    icon: <FaChartBar />,
    tone: 'lk-card-ico--amber',
    title: 'Product Performance',
    text: 'Classify products by demand level and evaluate performance against overall sales patterns.',
    tags: ['Segmentation'],
    span: 3,
    img: analyticsImg,
    alt: 'Product performance breakdown grouped by demand level',
  },
  {
    icon: <FaBoxes />,
    tone: 'lk-card-ico--green',
    title: 'Ingredient Management',
    text: 'Record ingredient stock, minimum levels, and restocks, then see every item measured against today’s forecasted need so shortages and excess show up early.',
    tags: ['Stock Tracking', 'Reorder Alerts'],
        img: inventoryImg2,
    alt: 'Ingredient management screen with stock levels and projected need',

    span: 3,
  },
  {
    icon: <FaClipboardList />,
    tone: 'lk-card-ico--ink',
    title: 'Product Management',
    text: 'Map each product to a recipe and see its cost of goods and food cost percentage against your recorded ingredient prices.',
    tags: ['Product Recipes', 'COGS & Food Cost'],
    span: 3,
    img: inventoryImg,
    alt: 'Product management screen listing menu items with recipes and stock levels',
  },
  {
    icon: <FaDatabase />,
    tone: 'lk-card-ico--ink',
    title: 'Data Management',
    text: 'Upload, review, and maintain the historical sales records that every forecast is trained on. Archive old periods, keep the training set current, and generate forecasts whenever the data changes.',
    tags: ['CSV / XLSX', 'Upload History'],
    span: 6,
    split: true,
    img: dataMgmtImg,
    alt: 'Data management screen for uploading and reviewing sales history',
  },
];

const STEPS = [
  {
    icon: <FaFileExcel />,
    title: 'Upload your sales data',
    text: 'Export your POS sales history as CSV or XLSX and upload it. Twelve or more months gives the most reliable signal.',
  },
  {
    icon: <FaBrain />,
    title: 'Train the model',
    text: 'The forecasting engine learns weekday, weekend, seasonal, and payday-related patterns from your history.',
  },
  {
    icon: <FaChartLine />,
    title: 'Review forecasts',
    text: 'Generate daily and weekly demand projections and inspect product-level performance breakdowns.',
  },
  {
    icon: <FaListOl />,
    title: 'Plan replenishment',
    text: 'Compare forecasted ingredient needs against current stock to see what may need reordering.',
  },
];

const SUPPORTS = [
  'Demand forecasting',
  'Product performance analysis',
  'Ingredient demand estimation',
  'Inventory monitoring',
  'Replenishment decision support',
];

const DOES_NOT = [
  'Automatically purchase ingredients',
  'Manage suppliers',
  'Process purchase orders',
  'Manage deliveries or logistics',
  'Replace business-owner decisions',
];

const FORMATS = ['CSV', 'XLSX'];
const FIELDS = [
  'Item Name',
  'Category',
  'Item Sold',
  'Gross Sales',
  'Refunds',
  'Net Sales',
];

const OUTCOMES = [
  {
    icon: <FaLayerGroup />,
    title: 'Prep matches the forecast',
    text: 'Ingredient requirements come from the same forecast your sales data describes, so prep and purchasing stop disagreeing with each other.',
    tint: '#7a0010',
  },
  {
    icon: <FaChartBar />,
    title: 'Dead stock becomes visible',
    text: 'Product performance separates items that actually move from the ones quietly tying up stock you assumed was essential.',
    tint: '#b31230',
  },
  {
    icon: <FaClock />,
    title: 'Patterns surface on their own',
    text: 'The weekday-versus-weekend and payday cycles already in your history get picked up automatically, instead of being tracked by hand.',
    tint: '#1c2632',
  },
];

const FAQS = [
  {
    q: 'How much sales history do I need?',
    a: 'At least 12 months of sales history is recommended for reliable forecasts. With 12 months or more, upload everything you have — more data helps the system identify recurring patterns such as weekday and weekend behavior, seasonal swings, and payday-related demand changes.',
  },
  {
    q: 'What file format should I upload?',
    a: 'ChefDuo Forecast accepts CSV and XLSX files. Your file should include Item Name, Category, Item Sold, Gross Sales, Refunds, and Net Sales so the model has both volume and revenue signals to work from.',
  },
  {
    q: 'Does it place orders or manage suppliers automatically?',
    a: 'No. ChefDuo Forecast is a decision-support system. It surfaces what may need replenishment, but purchasing, supplier management, purchase orders, and deliveries all stay under your control.',
  },
  {
    q: 'How are ingredient requirements calculated?',
    a: 'Ingredient demand combines predicted product demand with the recipe quantities you have recorded. If a forecast says you will sell more of a dish next week, the system works out what that means for each ingredient it needs.',
  },
  {
    q: 'How accurate are the forecasts?',
    a: 'Forecasts are estimates, not guarantees. Accuracy depends on the volume and consistency of the history you upload, and on whether real-world conditions match past patterns. Treat the output as one input alongside your own operational judgment.',
  },
  {
    q: 'Who can see my business data?',
    a: 'Your uploaded sales, product, and inventory data is used only to generate your forecasts. ChefDuo Forecast does not sell or rent your information to third parties, and handles personal information in accordance with the Data Privacy Act of 2012.',
  },
];

const Landing = () => {
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useReveal();

  return (
    <div className="lk-root" id="top">
      <a className="lk-skip" href="#main">
        Skip to content
      </a>

      <LandingNav />

      <main id="main">
        {/* ================= HERO ================= */}
        <section className="lk-hero">
          <div className="lk-container">
            <div className="lk-hero-inner">
              <div className="lk-hero-copy">
                <span className="lk-eyebrow">Demand Forecasting</span>
                <h1 className="lk-hero-title">
                  Smarter demand planning for <em>better supply decisions</em>
                </h1>
                <p className="lk-hero-lead">
                  ChefDuo Forecast reads your historical sales data, predicts
                  future product demand, translates that into ingredient
                  requirements, and shows where your current stock falls short —
                  so you plan with numbers instead of guesswork.
                </p>

                <div className="lk-hero-actions">
                  <Link to="/register" className="lk-btn lk-btn--primary lk-btn--lg">
                    Get Started
                    <FaArrowRight size={15} />
                  </Link>
                  <Link to="/features" className="lk-btn lk-btn--secondary lk-btn--lg">
                    Explore Features
                  </Link>
                </div>

              
              </div>

              <div className="lk-hero-visual">
                <div className="lk-hero-frame">
                  <img
                    src={dashboardImg}
                    alt="ChefDuo Forecast dashboard showing demand projections"
                  />
                </div>

                <div className="lk-float lk-float--tl">
                  <span className="lk-float-ico lk-float-ico--up">
                    <FaChartLine size={16} />
                  </span>
                  <span>
                    <span className="lk-float-value">Updated daily</span>
                  </span>
                </div>

                <div className="lk-float lk-float--br">
                  <span className="lk-float-ico lk-float-ico--amber">
                    <FaBolt size={16} />
                  </span>
                  <span>
                    <span className="lk-float-value">Ready to plan</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= STATS ================= */}
        <section className="lk-section lk-section--white">
          <div className="lk-container">
            <div className="lk-stats lk-reveal">
              {STATS.map((s) => (
                <div className="lk-stat" key={s.label}>
                  <div className="lk-stat-value">{s.value}</div>
                  <div className="lk-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= FEATURES ================= */}
        <section className="lk-section lk-section--tint" id="features">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">What the system does</span>
              <h2 className="lk-section-title">
                One platform from sales history to restocking decision
              </h2>
              <p className="lk-section-sub">
                Forecasting, product analysis, ingredient stock, and product
                recipes and costs brought together so the numbers behind each
                decision are in one place.
              </p>
            </div>

            <div className="lk-bento">
              {FEATURES.map((f) => {
                const shot = f.img ? (
                  <div className="lk-card-shot">
                    <img src={f.img} alt={f.alt} loading="lazy" />
                  </div>
                ) : null;

                return (
                  <article
                    className={`lk-card lk-card--span${f.span}${
                      f.split ? ' lk-card--split' : ''
                    } lk-reveal`}
                    key={f.title}
                  >
                    <div className="lk-card-copy">
                      <span className={`lk-card-ico ${f.tone}`}>{f.icon}</span>
                      <h3 className="lk-card-title">{f.title}</h3>
                      <p className="lk-card-text">{f.text}</p>
                      {!f.split && shot}
                      <div className="lk-card-tags">
                        {f.tags.map((t) => (
                          <span className="lk-tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    {f.split && shot}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section className="lk-section lk-section--white" id="how-it-works">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">How it works</span>
              <h2 className="lk-section-title">Four steps from upload to plan</h2>
              <p className="lk-section-sub">
                ChefDuo Forecast turns historical sales information into
                decision-support insights through a short, repeatable cycle.
              </p>
            </div>

            <div className="lk-steps">
              {STEPS.map((s) => (
                <div className="lk-step lk-reveal" key={s.title}>
                  <div className="lk-step-num" aria-hidden="true" />
                  <h3 className="lk-step-title">{s.title}</h3>
                  <p className="lk-step-text">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= DATA REQUIREMENTS ================= */}
        <section className="lk-section lk-section--cream" id="data">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">Data requirements</span>
              <h2 className="lk-section-title">What data you need</h2>
              <p className="lk-section-sub">
                ChefDuo Forecast uses historical sales information to identify
                demand patterns and generate forecasts. Here is exactly what to
                have ready.
              </p>
            </div>

            <div className="lk-spec lk-reveal">
              <div className="lk-spec-card">
                <h3 className="lk-spec-title">Supported formats</h3>
                                <br />

                <div className="lk-chiprow">
                  {FORMATS.map((f) => (
                    <span className="lk-chip lk-chip--brand" key={f}>
                      {f}
                    </span>
                  ))}
                </div>

                <h3 className="lk-spec-title" style={{ marginTop: 28 }}>
                  Required fields
                </h3>
                <br />
                <div className="lk-fieldlist">
                  {FIELDS.map((f) => (
                    <div className="lk-field" key={f}>
                      <FaCheck size={13} />
                      {f}
                    </div>
                  ))}
                </div>
              </div>

              <div className="lk-spec-card">
                <h3 className="lk-spec-title">
                  <FaUpload
                    size={15}
                    style={{
                      marginRight: 8,
                      verticalAlign: -2,
                      color: 'var(--lk-burgundy)',
                    }}
                  />
                  Getting the best forecast
                </h3>
                                <br />

                <p
                  style={{
                    fontSize: 14.6,
                    lineHeight: 1.68,
                    color: 'var(--lk-ink-500)',
                  }}
                >
                  Upload at least{' '}
                  <strong style={{ color: 'var(--lk-ink)' }}>
                    12 months
                  </strong>{' '}
                  of sales history for reliable forecasts. If you have 12 months
                  or more, upload everything.
                </p>

               

                <div className="lk-note">
                  <strong>Why more history matters.</strong> More data helps the
                  system identify recurring patterns such as weekday and weekend
                  behavior, seasonal patterns, and payday-related demand
                  variations.
                </div>

                
              </div>
            </div>
          </div>
        </section>

        {/* ================= SCOPE ================= */}
        <section className="lk-section lk-section--white">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">System scope</span>
              <h2 className="lk-section-title">Built for decision support</h2>
              <p className="lk-section-sub">
                ChefDuo Forecast provides information to support planning and
                inventory decisions. Being clear about where it stops helps you
                trust where it speaks.
              </p>
            </div>

            <div className="lk-compare lk-reveal">
              <div className="lk-compare-col lk-compare-col--yes">
                <div className="lk-compare-head">
                  <span className="lk-compare-badge">
                    <FaCheck />
                  </span>
                  <h3 className="lk-compare-title">The system supports</h3>
                </div>
                <ul className="lk-compare-list">
                  {SUPPORTS.map((s) => (
                    <li className="lk-compare-item" key={s}>
                      <FaCheck size={14} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lk-compare-col lk-compare-col--no">
                <div className="lk-compare-head">
                  <span className="lk-compare-badge">
                    <FaTimes />
                  </span>
                  <h3 className="lk-compare-title">
                    The system does not support
                  </h3>
                </div>
                <ul className="lk-compare-list">
                  {DOES_NOT.map((s) => (
                    <li className="lk-compare-item" key={s}>
                      <FaTimes size={14} />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="lk-callout lk-reveal">
              <FaLightbulb size={19} />
              <p className="lk-callout-text">
                <strong>Your data, your decisions.</strong> ChefDuo Forecast uses
                your provided business data to generate forecasting and
                decision-support information. Forecast results are estimates and
                should be interpreted together with actual business conditions
                and the owner’s operational judgment.
              </p>
            </div>
          </div>
        </section>

        {/* ================= OUTCOMES ================= */}
        <section className="lk-section lk-section--tint">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">What changes</span>
              <h2 className="lk-section-title">
                What planning with data actually changes
              </h2>
              <p className="lk-section-sub">
                The practical difference once prep, purchasing, and stock all read
                from the same forecast instead of separate guesses.
              </p>
            </div>

            <div className="lk-quotes">
              {OUTCOMES.map((o) => (
                <article className="lk-quote lk-reveal" key={o.title}>
                  <span
                    className="lk-quote-ico"
                    style={{ background: o.tint }}
                    aria-hidden="true"
                  >
                    {o.icon}
                  </span>
                  <h3 className="lk-quote-name">{o.title}</h3>
                  <p className="lk-quote-text">{o.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ================= FAQ ================= */}
        <section className="lk-section lk-section--white" id="faq">
          <div className="lk-container">
            <div className="lk-section-head lk-reveal">
              <span className="lk-eyebrow">FAQ</span>
              <h2 className="lk-section-title">Questions, answered</h2>
              <p className="lk-section-sub">
                The things operators ask us before they upload their first file.
              </p>
            </div>

            <div className="lk-reveal">
              <FaqAccordion items={FAQS} />
            </div>
          </div>
        </section>

</main>

      <LandingFooter
        onOpenPrivacy={() => setShowPrivacy(true)}
        onOpenTerms={() => setShowTerms(true)}
      />

      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </div>
  );
};

export default Landing;
