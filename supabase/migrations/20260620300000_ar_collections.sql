-- Accounts-Receivable / Collections, modelled on the CRM tracker's Payments
-- logic (terms -> due date, balance, days-past-due, aging, status, collections
-- follow-ups), built ON the existing finance_invoices (no duplicate table) and
-- connected to dispatch (source_dispatch_id) + customers (clients2 terms).
-- No data imported — structure/logic only.
BEGIN;

-- 1) Extend finance_invoices with the AR fields the logic needs.
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS payment_terms_days integer;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS amount_received numeric NOT NULL DEFAULT 0;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS po_ref text;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS source_dispatch_id uuid;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS owner_email text;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.finance_invoices ADD COLUMN IF NOT EXISTS balance numeric
  GENERATED ALWAYS AS (COALESCE(amount,0) - COALESCE(amount_received,0)) STORED;
-- AR invoices can be standalone (manual / from dispatch), not always tied to a
-- sales order or a customer uuid — relax the legacy NOT NULLs.
ALTER TABLE public.finance_invoices ALTER COLUMN sales_order_id DROP NOT NULL;
ALTER TABLE public.finance_invoices ALTER COLUMN customer_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_inv_customer ON public.finance_invoices(customer_code);
CREATE INDEX IF NOT EXISTS idx_fin_inv_due ON public.finance_invoices(due_date);

ALTER TABLE public.finance_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_inv_all ON public.finance_invoices;
CREATE POLICY fin_inv_all ON public.finance_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Payment receipts against invoices.
CREATE TABLE IF NOT EXISTS public.ar_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.finance_invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  paid_on date DEFAULT current_date,
  method text,
  note text,
  created_by_email text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_payments_invoice ON public.ar_payments(invoice_id);
ALTER TABLE public.ar_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ar_payments_all ON public.ar_payments;
CREATE POLICY ar_payments_all ON public.ar_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) View with computed status + days-past-due (status changes daily, so derived).
CREATE OR REPLACE VIEW public.v_ar_invoices AS
SELECT i.*,
  CASE WHEN i.balance <= 0 THEN 'paid'
       WHEN i.due_date IS NOT NULL AND i.due_date < current_date THEN 'overdue'
       WHEN COALESCE(i.amount_received,0) > 0 THEN 'partial'
       ELSE 'due' END AS ar_status,
  CASE WHEN i.balance > 0 AND i.due_date IS NOT NULL
       THEN GREATEST((current_date - i.due_date), 0) ELSE 0 END AS days_past_due
FROM public.finance_invoices i;
GRANT SELECT ON public.v_ar_invoices TO authenticated;

-- 4) Create an invoice (terms default from clients2, due date computed).
CREATE OR REPLACE FUNCTION public.ar_create_invoice(
  p_customer_code text, p_customer_name text, p_invoice_number text,
  p_invoice_date date, p_amount numeric, p_terms_days integer DEFAULT NULL,
  p_po_ref text DEFAULT NULL, p_dispatch_id uuid DEFAULT NULL, p_owner text DEFAULT NULL)
RETURNS public.finance_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_terms integer; v_row public.finance_invoices;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invoice amount must be > 0'; END IF;
  v_terms := COALESCE(p_terms_days,
    (SELECT NULLIF(regexp_replace(COALESCE(c."PaymentTerms",''), '[^0-9]', '', 'g'), '')::int
       FROM public.clients2 c WHERE lower(trim(c."ClientCode")) = lower(trim(p_customer_code)) LIMIT 1),
    30);
  INSERT INTO public.finance_invoices
    (invoice_number, customer_code, customer_name, invoice_date, amount, payment_terms_days,
     due_date, source_dispatch_id, po_ref, owner_email, status)
  VALUES (COALESCE(NULLIF(p_invoice_number,''), 'INV-'||to_char(now(),'YYMMDDHH24MISS')),
     p_customer_code, p_customer_name, COALESCE(p_invoice_date, current_date), p_amount, v_terms,
     COALESCE(p_invoice_date, current_date) + (v_terms || ' days')::interval,
     p_dispatch_id, p_po_ref, p_owner, 'ISSUED')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- 5) Record a payment receipt -> bumps amount_received.
CREATE OR REPLACE FUNCTION public.ar_record_payment(
  p_invoice_id uuid, p_amount numeric, p_paid_on date DEFAULT NULL,
  p_method text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.finance_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.finance_invoices; v_email text := public.rbac_current_email();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Payment must be > 0'; END IF;
  INSERT INTO public.ar_payments(invoice_id, amount, paid_on, method, note, created_by_email)
  VALUES (p_invoice_id, p_amount, COALESCE(p_paid_on, current_date), p_method, p_note, v_email);
  UPDATE public.finance_invoices
     SET amount_received = COALESCE(amount_received,0) + p_amount, updated_at = now(),
         status = CASE WHEN COALESCE(amount,0) - (COALESCE(amount_received,0)+p_amount) <= 0 THEN 'PAID' ELSE 'PARTIAL' END
   WHERE id = p_invoice_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  RETURN v_row;
END;
$$;

-- 6) AR dashboard: totals + aging + top debtors + status counts.
CREATE OR REPLACE FUNCTION public.ar_dashboard()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT * FROM public.v_ar_invoices)
  SELECT jsonb_build_object(
    'total_invoiced', COALESCE((SELECT sum(amount) FROM v),0),
    'total_received',  COALESCE((SELECT sum(amount_received) FROM v),0),
    'total_outstanding', COALESCE((SELECT sum(balance) FROM v WHERE balance>0),0),
    'overdue_amount', COALESCE((SELECT sum(balance) FROM v WHERE ar_status='overdue'),0),
    'invoice_count', (SELECT count(*) FROM v),
    'overdue_count', (SELECT count(*) FROM v WHERE ar_status='overdue'),
    'aging', jsonb_build_object(
      'current', COALESCE((SELECT sum(balance) FROM v WHERE balance>0 AND days_past_due=0),0),
      'd1_30',   COALESCE((SELECT sum(balance) FROM v WHERE days_past_due BETWEEN 1 AND 30),0),
      'd31_60',  COALESCE((SELECT sum(balance) FROM v WHERE days_past_due BETWEEN 31 AND 60),0),
      'd61_90',  COALESCE((SELECT sum(balance) FROM v WHERE days_past_due BETWEEN 61 AND 90),0),
      'd90_plus',COALESCE((SELECT sum(balance) FROM v WHERE days_past_due>90),0)),
    'status_counts', (SELECT COALESCE(jsonb_object_agg(ar_status, n),'{}'::jsonb) FROM (SELECT ar_status, count(*) n FROM v GROUP BY ar_status) s),
    'top_debtors', (SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM
      (SELECT customer_name, customer_code, sum(balance) outstanding, max(days_past_due) max_dpd
       FROM v WHERE balance>0 GROUP BY customer_name, customer_code ORDER BY sum(balance) DESC LIMIT 10) t)
  );
$$;

-- 7) Collections list for the CRM/dashboard reminder (overdue + due-soon).
CREATE OR REPLACE FUNCTION public.ar_collections(p_owner text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.days_past_due DESC, t.balance DESC),'[]'::jsonb)
  FROM (
    SELECT id, invoice_number, customer_code, customer_name, amount, amount_received, balance,
           due_date, days_past_due, ar_status, owner_email, po_ref
    FROM public.v_ar_invoices
    WHERE balance > 0 AND ar_status IN ('overdue','partial','due')
      AND (p_owner IS NULL OR lower(COALESCE(owner_email,'')) = lower(p_owner))
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.ar_create_invoice(text,text,text,date,numeric,integer,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ar_record_payment(uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ar_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ar_collections(text) TO authenticated;

COMMIT;
