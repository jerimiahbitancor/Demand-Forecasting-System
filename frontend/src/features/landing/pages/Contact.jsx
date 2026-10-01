// frontend/src/features/landing/pages/Contact.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaEnvelope,
  FaMapMarkerAlt,
  FaClock,
  FaArrowRight,
  FaPaperPlane,
  FaCheckCircle,
} from 'react-icons/fa';

import LandingNav from '../landing-kit/LandingNav';
import LandingFooter from '../landing-kit/LandingFooter';
import useReveal from '../landing-kit/useReveal';
import '../landing-kit/landing-kit.css';

const TOPICS = [
  'Product question',
  'Pricing and plans',
  'Data requirements',
  'Technical support',
  'Partnership',
  'Other',
];

const CHANNELS = [
  {
    icon: <FaEnvelope />,
    title: 'Email us',
    text: (
      <>
        <a href="mailto:BCF@gmail.com">BCF@gmail.com</a>
        <br />
        We reply within one business day.
      </>
    ),
  },
  {
    icon: <FaMapMarkerAlt />,
    title: 'Office',
    text: (
      <>
        Pasig City, Metro Manila
        <br />
        Philippines
      </>
    ),
  },
  {
    icon: <FaClock />,
    title: 'Support hours',
    text: (
      <>
        Monday to Friday
        <br />
        9:00 AM – 6:00 PM PHT
      </>
    ),
  },
];

const EMPTY = { name: '', email: '', topic: TOPICS[0], message: '' };

const Contact = () => {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);

  useReveal();

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSent(false);
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Please enter your name.';
    if (!form.email.trim()) {
      next.email = 'Please enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Please enter a valid email address.';
    }
    if (!form.message.trim()) {
      next.message = 'Please tell us how we can help.';
    } else if (form.message.trim().length < 10) {
      next.message = 'Please add a little more detail (at least 10 characters).';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    // No backend endpoint exists for public enquiries yet — this confirms the
    // message locally and points the user at the direct email channel.
    setSent(true);
  };

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
              <span>Contact</span>
            </div>
            <h1 className="lk-pagehead-title">Let&rsquo;s talk about your data</h1>
            <p className="lk-pagehead-sub">
              Questions about setup, or whether your sales history is
              enough? Send a note and we&rsquo;ll get back to you.
            </p>
          </div>
        </section>

        <section className="lk-section lk-section--white">
          <div className="lk-container">
            <div className="lk-infogrid lk-reveal" style={{ marginBottom: 34 }}>
              {CHANNELS.map((c) => (
                <div className="lk-infocard" key={c.title}>
                  <div className="lk-infocard-ico">{c.icon}</div>
                  <h2 className="lk-infocard-title">{c.title}</h2>
                  <p className="lk-infocard-text">{c.text}</p>
                </div>
              ))}
            </div>

            <div className="lk-spec lk-reveal">
              <div className="lk-spec-card">
                <h2 className="lk-spec-title">Send us a message</h2>

                {sent ? (
                  <div className="lk-form-alert lk-form-alert--ok">
                    <FaCheckCircle
                      size={15}
                      style={{ marginRight: 8, verticalAlign: -2 }}
                    />
                    Thanks, {form.name.trim().split(' ')[0]} — your message is
                    ready to send. Email it to{' '}
                    <strong>BCF@gmail.com</strong> and we&rsquo;ll reply within
                    one business day.
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="lk-btn lk-btn--secondary"
                        onClick={() => {
                          setForm(EMPTY);
                          setSent(false);
                        }}
                      >
                        Write another
                      </button>
                    </div>
                  </div>
                ) : (
                  <form className="lk-form" onSubmit={onSubmit} noValidate>
                    <div className="lk-form-row">
                      <div className="lk-field-group">
                        <label className="lk-label" htmlFor="c-name">
                          Name
                        </label>
                        <input
                          id="c-name"
                          className={`lk-input ${errors.name ? 'is-error' : ''}`}
                          value={form.name}
                          onChange={set('name')}
                          placeholder="Your name"
                          autoComplete="name"
                        />
                        {errors.name && (
                          <span className="lk-error-text">{errors.name}</span>
                        )}
                      </div>

                      <div className="lk-field-group">
                        <label className="lk-label" htmlFor="c-email">
                          Email
                        </label>
                        <input
                          id="c-email"
                          type="email"
                          className={`lk-input ${errors.email ? 'is-error' : ''}`}
                          value={form.email}
                          onChange={set('email')}
                          placeholder="you@business.com"
                          autoComplete="email"
                        />
                        {errors.email && (
                          <span className="lk-error-text">{errors.email}</span>
                        )}
                      </div>
                    </div>

                    <div className="lk-field-group">
                      <label className="lk-label" htmlFor="c-topic">
                        Topic
                      </label>
                      <select
                        id="c-topic"
                        className="lk-select"
                        value={form.topic}
                        onChange={set('topic')}
                      >
                        {TOPICS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="lk-field-group">
                      <label className="lk-label" htmlFor="c-message">
                        Message
                      </label>
                      <textarea
                        id="c-message"
                        className={`lk-textarea ${
                          errors.message ? 'is-error' : ''
                        }`}
                        value={form.message}
                        onChange={set('message')}
                        placeholder="Tell us what you are trying to solve, and roughly how much sales history you have."
                      />
                      {errors.message && (
                        <span className="lk-error-text">{errors.message}</span>
                      )}
                    </div>

                    <button type="submit" className="lk-btn lk-btn--primary">
                      <FaPaperPlane size={14} />
                      Send message
                    </button>
                  </form>
                )}
              </div>

              <div className="lk-spec-card">
                <span className="lk-eyebrow">Before you write</span>
                <h2 className="lk-spec-title">Quick answers</h2>

                <div className="lk-note" style={{ marginTop: 0 }}>
                  <strong>How much history do I need?</strong>
                  <br />
                  At least 12 months of sales history gives reliable forecasts. CSV
                  and XLSX are both accepted.
                </div>

                <div className="lk-note">
                  <strong>Does it place orders for me?</strong>
                  <br />
                  No. ChefDuo Forecast is decision support — it surfaces what needs
                  replenishment, and purchasing stays with you.
                </div>



                <div className="lk-note">
                  <strong>How is my data handled?</strong>
                  <br />
                  Your business data stays in your account, in line with the Data
                  Privacy Act of 2012.
                </div>
              </div>
            </div>
          </div>
        </section>

        </main>

      <LandingFooter />
    </div>
  );
};

export default Contact;
