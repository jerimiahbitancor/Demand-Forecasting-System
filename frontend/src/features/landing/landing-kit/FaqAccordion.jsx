// frontend/src/features/landing/landing-kit/FaqAccordion.jsx
import { useState } from 'react';
import { FaPlus } from 'react-icons/fa';
import './landing-kit.css';

export default function FaqAccordion({ items }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="lk-faq">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={item.q}
            className={`lk-faq-item ${isOpen ? 'is-open' : ''}`}
          >
            <button
              type="button"
              className="lk-faq-btn"
              onClick={() => setOpenIndex(isOpen ? -1 : i)}
              aria-expanded={isOpen}
            >
              {item.q}
              <span className="lk-faq-icon" aria-hidden="true">
                <FaPlus size={13} />
              </span>
            </button>
            <div className="lk-faq-panel" style={{ maxHeight: isOpen ? 500 : 0 }}>
              <div className="lk-faq-body">{item.a}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
