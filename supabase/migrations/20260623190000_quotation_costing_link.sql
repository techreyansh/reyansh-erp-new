-- Hard link quotation items to a costing version (exact, replaces name-matching).
alter table public.crm_quotation_items
  add column if not exists costing_version_id uuid references public.costing_version(id) on delete set null;
-- backfill existing items by product-name match (one-time)
update public.crm_quotation_items i set costing_version_id = cv.id
from public.costing_version cv
where i.costing_version_id is null and cv.status <> 'superseded'
  and lower(trim(cv.product_name)) = lower(trim(i.product));
