  // frontend/src/features/landing/pages/About.jsx
  import { Link } from 'react-router-dom';
  import {
    FaArrowRight,
    FaBullseye,
    FaBalanceScale,
    FaHeart,
    FaChartLine,
    FaShieldAlt,
    FaRegLightbulb,
  } from 'react-icons/fa';

  import LandingNav from '../landing-kit/LandingNav';
  import LandingFooter from '../landing-kit/LandingFooter';
  import useReveal from '../landing-kit/useReveal';
  import '../landing-kit/landing-kit.css';

  import dashboardImg from '../../../assets/landing/Dashboard.png';

  const VALUES = [
    {
      icon: <FaBullseye />,
      title: 'Decision support, not autopilot',
      text: 'Forecasts inform the decision. We never make the purchasing call for you, because the person who knows the supplier and the kitchen knows more than any model.',
    },
    {
      icon: <FaBalanceScale />,
      title: 'Honest about limits',
      text: 'A forecast is an estimate. We state plainly where the system stops, so you never mistake a projection for a guarantee.',
    },
    {
      icon: <FaHeart />,
      title: 'Built for small operators',
      text: 'This started from a real food business problem, not a dashboard demo. The workflow fits how an owner-operator actually plans and buys.',
    },
    {
      icon: <FaShieldAlt />,
      title: 'Privacy by default',
      text: 'Your sales and inventory data stays in your account, handled under the Data Privacy Act of 2012.',
    },
  ];

  const PRINCIPLES = [
    'Show the reasoning behind a number, not just the number',
    'Say when data is insufficient instead of guessing',
    'Keep estimates clearly separated from measured facts',
    'Let the owner override anything the system suggests',
  ];

  const About = () => {
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
                <span>About</span>
              </div>
              <h1 className="lk-pagehead-title">
                Planning by feel is expensive. We built something better.
              </h1>
              <p className="lk-pagehead-sub">
                ChefDuo Forecast exists because small food businesses were making
                real purchasing decisions from guesswork, and paying for the
                mistakes that followed.
              </p>
            </div>
          </section>

          <section className="lk-section lk-section--white">
            <div className="lk-container">
              <div className="lk-about-split">
                <div className="lk-reveal">
                  <span className="lk-eyebrow">Why we built it</span>
                  <h2
                    className="lk-section-title"
                    style={{ marginBottom: 20, textAlign: 'left' }}
                  >
                    The data already existed. Nobody was using it.
                  </h2>
                  <p
                    style={{
                      fontSize: 15.4,
                      lineHeight: 1.75,
                      color: 'var(--lk-ink-500)',
                      marginBottom: 16,
                    }}
                  >
                    Most food businesses already have years of sales records sitting
                    in a POS export. What they rarely have is anyone reading them.
                    Prep gets decided by memory, purchasing by habit, and the gap
                    between what you sell and what you bought is invisible until the
                    money is gone.
                  </p>
                  <p
                    style={{
                      fontSize: 15.4,
                      lineHeight: 1.75,
                      color: 'var(--lk-ink-500)',
                      marginBottom: 16,
                    }}
                  >
                    ChefDuo Forecast reads that history, learns what your demand
                    actually does week to week, and tells you plainly what to
                    prepare and what is running short. It is not a replacement for
                    your judgment — it is the thing that makes your judgment better
                    informed.
                  </p>
                  <p
                    style={{
                      fontSize: 15.4,
                      lineHeight: 1.75,
                      color: 'var(--lk-ink-500)',
                    }}
                  >
                    The system is honest about being a decision-support tool. It
                    shows its work, flags when data is too thin to trust, and stops
                    where your authority starts.
                  </p>
                </div>

                <div className="lk-reveal">
                  <div
                    style={{
                      borderRadius: 'var(--lk-r-xl)',
                      overflow: 'hidden',
                      border: '1px solid var(--lk-line)',
                      boxShadow: 'var(--lk-shadow-lg)',
                      background: 'var(--lk-white)',
                    }}
                  >
                    <img
                      src={dashboardImg}
                      alt="ChefDuo Forecast dashboard"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="lk-section lk-section--tint">
            <div className="lk-container">
              <div className="lk-section-head lk-reveal">
                <span className="lk-eyebrow">What we believe</span>
                <h2 className="lk-section-title">Four things we won&#39;t compromise</h2>
                <p className="lk-section-sub">
                  These shape how the product behaves when the data gets awkward.
                </p>
              </div>

              <div className="lk-values lk-reveal">
                {VALUES.map((v) => (
                  <div className="lk-value" key={v.title}>
                    <div className="lk-infocard-ico">{v.icon}</div>
                    <h3 className="lk-value-title">{v.title}</h3>
                    <p className="lk-value-text">{v.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="lk-section lk-section--white">
            <div className="lk-container">
              <div className="lk-spec lk-reveal">
                <div className="lk-spec-card">
                  <span className="lk-eyebrow">How we build</span>
                  <h2 className="lk-spec-title">Product principles</h2>
                  <ul className="lk-compare-list">
                    {PRINCIPLES.map((p) => (
                      <li className="lk-compare-item" key={p}>
                        <FaRegLightbulb
                          size={13}
                          style={{ color: 'var(--lk-burgundy)' }}
                        />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="lk-spec-card">
                  <span className="lk-eyebrow">How it works internally</span>
                  <h2 className="lk-spec-title">How it predicts</h2>
                  <p
                    style={{
                      fontSize: 14.6,
                      lineHeight: 1.7,
                      color: 'var(--lk-ink-500)',
                      marginBottom: 14,
                    }}
                  >
                    Forecasting is handled by gradient-boosted tree models trained on
                    your uploaded history. Rather than assuming a single trend, the
                    model captures the conditional patterns that actually move
                    demand — day of week, season, and recurring cycles.
                  </p>
                  <div className="lk-note" style={{ marginTop: 0 }}>
                    <strong>Where it does not apply.</strong> Promotions, sudden
                    menu changes, and one-off events are not in your history, so no
                    model can anticipate them. That is why outputs are presented as
                    estimates to plan against, never as commitments.
                  </div>
                </div>
              </div>

              <div className="lk-callout lk-reveal">
                <FaChartLine size={19} />
                <p className="lk-callout-text">
                  <strong>Good forecasts, honestly framed.</strong> ChefDuo Forecast
                  is designed to support planning and inventory decisions. It does
                  not automatically purchase ingredients, manage suppliers, process
                  purchase orders, or arrange deliveries.
                </p>
              </div>
            </div>
          </section>

          </main>

        <LandingFooter />
      </div>
    );
  };

  export default About;
