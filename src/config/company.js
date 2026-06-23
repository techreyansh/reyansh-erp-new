// Seller (your own company) details for tax invoices. No company-profile table
// exists yet, so these live here — edit to match your GST registration.
// stateCode drives intra-state (CGST+SGST) vs inter-state (IGST) detection.
export const SELLER = {
  name: 'Reyansh International',
  addressLines: ['', ''],
  gstin: '',            // e.g. '27ABCDE1234F1Z5'
  state: '',            // e.g. 'Maharashtra'
  stateCode: '',        // 2-digit GST state code, e.g. '27'
  email: 'reyanshinternational63@gmail.com',
  phone: '',
};

export const DEFAULT_GST_RATE = 18;
