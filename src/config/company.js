// Seller (your own company) details for tax invoices. No company-profile table
// exists yet, so these live here — edit to match your GST registration.
// stateCode drives intra-state (CGST+SGST) vs inter-state (IGST) detection.
export const SELLER = {
  name: 'Reyansh International',
  addressLines: ['', ''],
  gstin: '09AAECR0689R1ZH', // PAN AAECR0689R
  state: 'Uttar Pradesh',
  stateCode: '09',          // GST state code 09 = Uttar Pradesh
  email: 'reyanshinternational63@gmail.com',
  phone: '',
};

export const DEFAULT_GST_RATE = 18;
