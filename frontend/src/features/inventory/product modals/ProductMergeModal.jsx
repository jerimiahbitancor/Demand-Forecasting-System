// product modals/ProductMergeModal.jsx
//
// "Merge into..." (owner's v3 flowchart, page 4): pick the product to keep,
// read what will happen, then confirm. The merge runs on the server as one
// database transaction (POST /api/products/:id/merge).
import { useEffect, useMemo, useState } from 'react';
import { FaTimes, FaCodeBranch, FaExchangeAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import InventoryModal from '../components/InventoryModal';
import apiClient from '../../../services/apiClient';
import './ProductMergeModal.css';

const MAX_SHOWN = 8;

const ProductMergeModal = ({
  source: initialSource, initialTargetId = null, onClose, onMerged,
  // PRODUCT_MERGE_ENABLED: off -> the preview still works (read-only), but
  // Confirm is disabled.
  mergeEnabled = false, mergeDisabledMessage = 'Combining products is turned off for now. You can still preview what would change.',
}) => {
  const [source, setSource] = useState(initialSource);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  // The last preview answer, tagged with the request it answers. What is
  // shown is derived from it, so a changed pick never shows an old preview.
  const [previewState, setPreviewState] = useState({ key: null, data: null, error: null });
  const [merging, setMerging] = useState(false);

  const previewKey = source && target ? `${source.id}>${target.id}` : null;
  const previewReady = previewKey !== null && previewState.key === previewKey;
  const preview = previewReady ? previewState.data : null;
  const previewError = previewReady ? previewState.error : null;
  const loadingPreview = previewKey !== null && !previewReady;

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/mapping/products', { params: { status: 'all', forceRefresh: true } })
      .then((productsRes) => {
        if (cancelled) return;
        const list = productsRes.data?.data || productsRes.data?.products || [];
        setProducts(Array.isArray(list) ? list : []);
        if (initialTargetId) {
          const found = (Array.isArray(list) ? list : []).find((p) => p.id === initialTargetId);
          if (found) setTarget({ id: found.id, name: found.name });
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(error.apiError?.message || 'Could not load the products.');
      });
    return () => { cancelled = true; };
  }, [initialTargetId]);

  useEffect(() => {
    if (!previewKey) return undefined;
    let cancelled = false;
    apiClient.get(`/products/${source.id}/merge-preview`, {
      params: { targetId: target.id },
    })
      .then((res) => {
        if (!cancelled) setPreviewState({ key: previewKey, data: res.data?.data || null, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewState({ key: previewKey, data: null, error: error.apiError?.message || 'Could not check what would change.' });
        }
      });
    return () => { cancelled = true; };
  }, [previewKey, source, target]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => p.id !== source?.id && p.status !== 'archived' && !p.is_archived)
      .filter((p) => !q || String(p.name).toLowerCase().includes(q))
      .slice(0, MAX_SHOWN);
  }, [products, search, source]);

  const close = () => {
    if (!merging) onClose();
  };

  const swap = () => {
    if (!target) return;
    setSource(target);
    setTarget(source);
  };

  const confirm = async () => {
    if (!preview || merging || !mergeEnabled) return;
    setMerging(true);
    try {
      const res = await apiClient.post(`/products/${source.id}/merge`, {
        targetId: target.id,
      });
      const r = res.data?.data?.result || {};
      toast.success(`Combined "${source.name}" with "${target.name}": ${r.days_moved ?? preview.daysMoved} day(s) of sales moved.`);
      onMerged && onMerged(res.data?.data);
    } catch (error) {
      toast.error(error.apiError?.message || 'Combining failed. Nothing was changed.');
      setMerging(false);
    }
  };

  if (!source) return null;

  return (
    <InventoryModal className="modal-md product-merge-modal" onClose={close}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">Combine with another product</h3>
        <button className="modal-close-btn" onClick={close} aria-label="Close combine dialog">
          <FaTimes />
        </button>
      </div>

      <div className="modal-body inventory-modal-body">
        <p className="merge-intro">
          Use this when the same product was saved under two names (for example a typo
          like &quot;Porksilog&quot; and &quot;Pork Silog&quot;). All past sales of <strong>&quot;{source.name}&quot;</strong> move
          to the product you keep, and the other name is retired.
        </p>

        <label className="merge-label" htmlFor="merge-target-search">Product to keep</label>
        <p className="merge-hint">Pick the one with the correct name. Usually it&apos;s the one with more sales history.</p>
        {target ? (
          <div className="merge-picked">
            <span><strong>{target.name}</strong></span>
            <span className="merge-picked-actions">
              <button type="button" className="btn-secondary merge-small-btn" onClick={swap} disabled={merging} title="Keep the other one instead">
                <FaExchangeAlt /> Swap
              </button>
              <button type="button" className="btn-secondary merge-small-btn" onClick={() => setTarget(null)} disabled={merging}>
                Change
              </button>
            </span>
          </div>
        ) : (
          <>
            <input
              id="merge-target-search"
              className="merge-search"
              type="search"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <ul className="merge-candidates">
              {candidates.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setTarget({ id: p.id, name: p.name })}>{p.name}</button>
                </li>
              ))}
              {candidates.length === 0 && <li className="merge-empty">No matching products.</li>}
            </ul>
          </>
        )}

        {loadingPreview && <p className="merge-hint">Checking what will change...</p>}
        {previewError && <p className="merge-error">{previewError}</p>}
        {!mergeEnabled && <p className="merge-error">{mergeDisabledMessage}</p>}
        {preview && !loadingPreview && (
          <div className="merge-preview">
            <h4>What will happen</h4>
            <ul>
              {preview.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="modal-footer inventory-modal-footer">
        <button className="btn-secondary" onClick={close} disabled={merging}>Cancel</button>
        <button
          className="btn-primary"
          onClick={confirm}
          disabled={!preview || loadingPreview || merging || !mergeEnabled}
          title={mergeEnabled ? undefined : mergeDisabledMessage}
        >
          {merging ? 'Combining…' : <><FaCodeBranch /> Confirm combine</>}
        </button>
      </div>
    </InventoryModal>
  );
};

export default ProductMergeModal;
