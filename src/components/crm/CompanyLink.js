import React from 'react';
import { Box } from '@mui/material';
import useCompany360 from './useCompany360';

/**
 * A company name that opens the full Client 360 profile on click — drop-in for
 * any CRM list (top customers/debtors, worklist, reports, recent activity).
 * Pass a customer_code and/or pipeline id plus the display name. Self-contained:
 * owns its own 360 drawer (portaled out), so it works inside any cell/Typography
 * without prop threading. stopPropagation keeps row-level handlers from firing.
 *
 *   <CompanyLink code={r.customer_code} name={r.company_name} />
 */
export default function CompanyLink({ id, code, name, children, sx, notify, ...rest }) {
  const { open, drawer } = useCompany360(notify);
  const label = children ?? name ?? code ?? 'Customer';
  const go = (e) => {
    e.stopPropagation();
    e.preventDefault();
    open({ id, customer_code: code, company_name: name });
  };
  return (
    <>
      <Box
        component="span"
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go(e); }}
        sx={{
          cursor: 'pointer',
          '&:hover': { textDecoration: 'underline', color: 'primary.main' },
          ...sx,
        }}
        {...rest}
      >
        {label}
      </Box>
      {drawer}
    </>
  );
}
