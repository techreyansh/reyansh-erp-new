-- GST tax-invoice layer on top of the existing finance_invoices (AR) header.
alter table public.finance_invoices
  add column if not exists taxable_value numeric default 0,
  add column if not exists gst_rate numeric default 18,
  add column if not exists cgst numeric default 0,
  add column if not exists sgst numeric default 0,
  add column if not exists igst numeric default 0,
  add column if not exists round_off numeric default 0,
  add column if not exists place_of_supply text,
  add column if not exists customer_gstin text,
  add column if not exists seller_gstin text,
  add column if not exists inter_state boolean default false;

create table if not exists public.finance_invoice_line (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_invoices(id) on delete cascade,
  product_code text,
  product_name text,
  hsn text,
  qty numeric default 0,
  uom text,
  rate numeric default 0,
  taxable_value numeric default 0,
  gst_rate numeric default 18,
  cgst numeric default 0,
  sgst numeric default 0,
  igst numeric default 0,
  amount numeric default 0,
  sequence integer default 0
);
create index if not exists idx_finv_line on public.finance_invoice_line (invoice_id);

alter table public.finance_invoice_line enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='finance_invoice_line' and policyname='finv_line_all') then
    create policy finv_line_all on public.finance_invoice_line for all using (true) with check (true);
  end if;
end $$;
