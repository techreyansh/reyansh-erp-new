import React, { useCallback, useState } from 'react';
import crmPipelineService from '../../services/crmPipelineService';
import Client360 from './Client360';

/**
 * Reusable "open the company 360" behaviour for any CRM list that shows a
 * company name. Call `open({ id?, customer_code?, company_name? })` from a click
 * handler and render `drawer` somewhere in the component. Resolves the full
 * account row first (by pipeline id, else by customer_code) so the 360's
 * operational tabs load; falls back to a minimal account if it can't resolve
 * (e.g. RLS hides it). One <Client360> instance, shared everywhere.
 *
 *   const { open, drawer } = useCompany360(notify);
 *   <span onClick={() => open({ customer_code: row.customer_code, company_name: row.company_name })}>…</span>
 *   {drawer}
 */
export default function useCompany360(notify) {
  const [account, setAccount] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);

  const open = useCallback(async ({ id, customer_code, company_name } = {}) => {
    if (!id && !customer_code && !company_name) return;
    const key = id || customer_code || company_name;
    setLoadingKey(key);
    let acct = null;
    try {
      if (id) {
        const res = await crmPipelineService.getCompany(id);
        acct = res?.company || null;
      } else if (customer_code) {
        acct = await crmPipelineService.getCompanyByCode(customer_code);
      } else {
        // company_name is unique in crm_pipeline — safe last-resort resolve.
        acct = await crmPipelineService.getCompanyByName(company_name);
      }
    } catch {
      acct = null;
    }
    if (!acct) acct = { id: id || null, customer_code: customer_code || null, company_name: company_name || null };
    setLoadingKey(null);
    setAccount(acct);
  }, []);

  const drawer = account ? (
    <Client360 account={account} onClose={() => setAccount(null)} notify={notify} />
  ) : null;

  return { open, drawer, loadingKey };
}
