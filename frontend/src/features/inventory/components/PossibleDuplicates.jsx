// components/PossibleDuplicates.jsx
//
// "Possible duplicates" on Product Management: pairs of products whose names
// look alike (a typo, or an abbreviation like "OG" for "Original"). Pairs
// that only differ by a size word or a modifier are left out on the server.
// Suggestions only: nothing is merged unless the owner reviews and confirms.
import { useEffect, useState } from 'react';
import { FaCodeBranch } from 'react-icons/fa';
import apiClient from '../../../services/apiClient';
import './PossibleDuplicates.css';

const REASON = {
  typo: 'names differ by a few letters',
  abbreviation: 'one name looks like a short form of the other',
};

const PossibleDuplicates = ({ refreshKey = 0, onReview }) => {
  const [pairs, setPairs] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/products/duplicates')
      .then((res) => { if (!cancelled) setPairs(res.data?.data?.pairs || []); })
      .catch(() => { if (!cancelled) setPairs([]); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!pairs || pairs.length === 0) return null;

  return (
    <section className="possible-duplicates" aria-labelledby="possible-duplicates-title">
      <button
        type="button"
        className="possible-duplicates__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span id="possible-duplicates-title">
          Possible duplicates ({pairs.length})
        </span>
        <span className="possible-duplicates__chev">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="possible-duplicates__intro">
            These products have names that look alike. If two of them are really the same product, combine them.
            Keep the one with the correct name (usually the one with more sales history). Nothing changes until you confirm.
          </p>
          <ul className="possible-duplicates__list">
            {pairs.map((pair) => (
              <li key={`${pair.a.id}-${pair.b.id}`} className="possible-duplicates__row">
                <span className="possible-duplicates__names">
                  <strong>{pair.a.name}</strong> and <strong>{pair.b.name}</strong>
                  <span className="possible-duplicates__reason"> — {REASON[pair.reason] || 'names look alike'}</span>
                </span>
                <button
                  type="button"
                  className="btn-secondary possible-duplicates__btn"
                  onClick={() => onReview && onReview({ source: pair.b, target: pair.a })}
                >
                  <FaCodeBranch /> Review and combine
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default PossibleDuplicates;
