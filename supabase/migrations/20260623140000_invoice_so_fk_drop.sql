-- finance_invoices.sales_order_id pointed at the empty legacy sales_orders
-- table. The new sales_order engine is canonical now; drop the obsolete FK so
-- invoices can reference new sales orders (column kept as a loose reference).
alter table public.finance_invoices drop constraint if exists finance_invoices_sales_order_id_fkey;
