// product modals/ProductMergeModal.jsx
//
// "Merge into..." (owner's v3 flowchart, page 4): pick the product to keep,
// optionally a modifier (e.g. "Chick & Fries NO FRIES" is Chick & Fries with
// the NO FRIES modifier), read what will happen, then confirm. The merge runs
// on the server as one database transaction (POST /api/products/:id/merge).
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
  mergeEnabled = false, mergeDisabledMessage = 'Merging is turned off for now.',
}) => {
  const [source, setSource] = useState(initialSource);
  const [products, setProducts] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);
  const [keyword, setKeyword] = useState('');
  // The last preview answer, tagged with the request it answers. What is
  // shown is derived from it, so a changed pick never shows an old preview.
  const [previewState, setPreviewState] = useState({ key: null, data: null, error: null });
  const [merging, setMerging] = useState(false);

  const previewKey = source && target ? `${source.id}>${target.id}>${keyword}` : null;
  const previewReady = previewKey !== null && previewState.key === previewKey;
  const preview = previewReady ? previewState.data : null;
  const previewError = previewReady ? previewState.error : null;
  const loadingPreview = previewKey !== null && !previewReady;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get('/mapping/products', { params: { status: 'all', forceRefresh: true } }),
      apiClient.get('/products/modifier-keywords'),
    ])
      .then(([productsRes, keywordsRes]) => {
        if (cancelled) return;
        const list = productsRes.data?.data || productsRes.data?.products || [];
        setProducts(Array.isArray(list) ? list : []);
        setKeywords(keywordsRes.data?.data?.keywords || []);
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
      params: { targetId: target.id, modifierKeyword: keyword || undefined },
    })
      .then((res) => {
        if (!cancelled) setPreviewState({ key: previewKey, data: res.data?.data || null, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewState({ key: previewKey, data: null, error: error.apiError?.message || 'Could not preview this merge.' });
        }
      });
    return () => { cancelled = true; };
  }, [previewKey, source, target, keyword]);

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
        modifierKeyword: keyword || undefined,
      });
      const r = res.data?.data?.result || {};
      toast.success(`Merged "${source.name}" into "${target.name}": ${r.days_moved ?? preview.daysMoved} day(s) of sales moved.`);
      onMerged && onMerged(res.data?.data);
    } catch (error) {
      toast.error(error.apiError?.message || 'The merge failed. Nothing was changed.');
      setMerging(false);
    }
  };

  if (!source) return null;

  return (
    <InventoryModal className="modal-md product-merge-modal" onClose={close}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">Merge Product</h3>
        <button className="modal-close-btn" onClick={close} aria-label="Close merge dialog">
          <FaTimes />
        </button>
      </div>

      <div className="modal-body inventory-modal-body">
        <p className="merge-intro">
          Merge <strong>&quot;{source.name}&quot;</strong> into another product. Its sales history moves to the product you keep.
        </p>

        <label className="merge-label" htmlFor="merge-target-search">Product to keep</label>
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

        <label className="merge-label" htmlFor="merge-modifier">Modifier (optional)</label>
        <select
          id="merge-modifier"
          className="merge-select"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          disabled={merging}
        >
          <option value="">None — it is the same dish</option>
          {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <p className="merge-hint">
          Use a modifier when this product is the kept one with something left out, like &quot;NO FRIES&quot;.
          {keywords.length === 0 ? ' No modifiers are set up yet.' : ''}
        </p>

        {loadingPreview && <p className="merge-hint">Checking what will change...</p>}
        {previewError && <p className="merge-error">{previewError}</p>}
        {!mergeEnabled && <p className="merge-error">{mergeDisabledMessage} You can still preview what a merge would do.</p>}
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
          {merging ? 'Merging...' : <><FaCodeBranch /> Confirm merge</>}
        </button>
      </div>
    </InventoryModal>
  );
};

export default ProductMergeModal;
