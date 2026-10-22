-- Migration 014: carry inventory shortages forward and settle them from later restocks.
--
-- A sale upload still deducts only the stock on hand. Any unfulfilled amount
-- is tracked per sale transaction and consumes incoming restocks before they
-- increase the available stock balance.

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS received_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS shortfall_settled_quantity numeric(18,6);

CREATE TABLE IF NOT EXISTS public.inventory_shortfall_balances (
  sale_transaction_id uuid PRIMARY KEY
    REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
  ingredient_id integer NOT NULL
    REFERENCES public.ingredients(id) ON DELETE CASCADE,
  reference_type text NOT NULL,
  reference_id integer NOT NULL,
  original_quantity numeric(18,6) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity numeric(18,6) NOT NULL CHECK (remaining_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS inventory_shortfall_balances_pending_fifo
  ON public.inventory_shortfall_balances (ingredient_id, created_at, sale_transaction_id)
  WHERE remaining_quantity > 0;

REVOKE ALL ON TABLE public.inventory_shortfall_balances FROM anon, authenticated;
GRANT ALL ON TABLE public.inventory_shortfall_balances TO service_role;

-- Preserve outstanding shortfalls logged before this migration was installed.
INSERT INTO public.inventory_shortfall_balances (
  sale_transaction_id, ingredient_id, reference_type, reference_id,
  original_quantity, remaining_quantity, created_at
)
SELECT
  t.id, t.ingredient_id, t.reference_type, t.reference_id,
  t.shortfall_quantity, t.shortfall_quantity, t.created_at
FROM public.inventory_transactions t
WHERE t.transaction_type = 'sale'
  AND t.shortfall_quantity > 0
  AND t.reference_type IS NOT NULL
  AND t.reference_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_transactions adjustment
    WHERE adjustment.ingredient_id = t.ingredient_id
      AND adjustment.transaction_type = 'adjustment'
      AND adjustment.created_at > t.created_at
  )
ON CONFLICT (sale_transaction_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.track_inventory_sale_shortfall()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_type = 'adjustment'
     AND NEW.ingredient_id IS NOT NULL THEN
    -- A manual count supersedes older shortages because the counted balance
    -- already reflects the stock actually on hand.
    UPDATE public.inventory_shortfall_balances
    SET remaining_quantity = 0,
        updated_at = timezone('utc'::text, now())
    WHERE ingredient_id = NEW.ingredient_id
      AND remaining_quantity > 0
      AND created_at <= NEW.created_at;
  ELSIF NEW.transaction_type = 'sale'
     AND NEW.shortfall_quantity IS NOT NULL
     AND NEW.shortfall_quantity > 0
     AND NEW.ingredient_id IS NOT NULL
     AND NEW.reference_type IS NOT NULL
     AND NEW.reference_id IS NOT NULL THEN
    INSERT INTO public.inventory_shortfall_balances (
      sale_transaction_id, ingredient_id, reference_type, reference_id,
      original_quantity, remaining_quantity, created_at
    ) VALUES (
      NEW.id, NEW.ingredient_id, NEW.reference_type, NEW.reference_id,
      NEW.shortfall_quantity, NEW.shortfall_quantity, NEW.created_at
    )
    ON CONFLICT (sale_transaction_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_transactions_track_shortfall ON public.inventory_transactions;
CREATE TRIGGER inventory_transactions_track_shortfall
AFTER INSERT ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.track_inventory_sale_shortfall();

CREATE OR REPLACE FUNCTION public.restock_ingredient_stock(
  p_ingredient_id integer,
  p_quantity text,
  p_updated_by integer DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  previous_quantity numeric,
  new_quantity numeric,
  received_quantity numeric,
  shortfall_settled_quantity numeric,
  added_quantity numeric,
  unit text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_received numeric(18,6);
  v_unallocated numeric(18,6);
  v_old_quantity numeric(18,6);
  v_new_quantity numeric(18,6);
  v_settled numeric(18,6) := 0;
  v_to_settle numeric(18,6);
  v_unit text;
  v_pending record;
  v_movement_notes text;
BEGIN
  v_received := round(p_quantity::numeric, 6)::numeric(18,6);
  IF v_received <= 0 THEN
    RAISE EXCEPTION 'Restock quantity must be greater than zero';
  END IF;

  -- Serialize restocks and sales for this ingredient, including the queue.
  SELECT i.quantity, i.unit
    INTO v_old_quantity, v_unit
  FROM public.ingredients i
  WHERE i.id = p_ingredient_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient % does not exist', p_ingredient_id;
  END IF;

  v_unallocated := v_received;
  FOR v_pending IN
    SELECT b.sale_transaction_id, b.remaining_quantity
    FROM public.inventory_shortfall_balances b
    WHERE b.ingredient_id = p_ingredient_id
      AND b.remaining_quantity > 0
    ORDER BY b.created_at, b.sale_transaction_id
    FOR UPDATE
  LOOP
    EXIT WHEN v_unallocated <= 0;
    v_to_settle := LEAST(v_unallocated, v_pending.remaining_quantity);
    UPDATE public.inventory_shortfall_balances b
    SET remaining_quantity = b.remaining_quantity - v_to_settle,
        updated_at = timezone('utc'::text, now())
    WHERE b.sale_transaction_id = v_pending.sale_transaction_id;
    v_unallocated := v_unallocated - v_to_settle;
    v_settled := v_settled + v_to_settle;
  END LOOP;

  v_new_quantity := v_old_quantity + v_unallocated;
  UPDATE public.ingredients
  SET quantity = v_new_quantity,
      updated_by = COALESCE(p_updated_by, updated_by)
  WHERE id = p_ingredient_id;

  v_movement_notes := concat_ws(
    ' ',
    NULLIF(btrim(p_notes), ''),
    format(
      'Received %s %s; %s settled previous sales shortfalls; %s added to available stock.',
      v_received, v_unit, v_settled, v_unallocated
    )
  );

  INSERT INTO public.inventory_transactions (
    ingredient_id, transaction_type, quantity, previous_quantity, new_quantity,
    requested_quantity, applied_quantity, shortfall_quantity,
    received_quantity, shortfall_settled_quantity, unit,
    reason, notes, created_by
  ) VALUES (
    p_ingredient_id, 'restock', v_unallocated, v_old_quantity, v_new_quantity,
    v_received, v_unallocated, 0,
    v_received, v_settled, v_unit,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Restock'),
    v_movement_notes, p_updated_by
  );

  RETURN QUERY SELECT
    v_old_quantity::numeric, v_new_quantity::numeric, v_received::numeric,
    v_settled::numeric, v_unallocated::numeric, v_unit;
END;
$$;

COMMENT ON FUNCTION public.restock_ingredient_stock(integer, text, integer, text, text) IS
  'Atomically records received stock, settles outstanding sale shortfalls FIFO, and adds only the remainder to available inventory.';
