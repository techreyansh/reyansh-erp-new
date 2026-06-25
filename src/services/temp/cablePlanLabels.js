// Bilingual (English / Hindi) labels for the Cable Planning Workbench operator
// job cards + master sheet. Shop-floor operators must be able to read and fill
// the printed sheet themselves, so every field supports EN, HI, or both.
// makeT(lang) returns a translate fn: lang ∈ { english, hindi, bilingual }.

export const LANGS = [
  { value: 'bilingual', label: 'Bilingual / द्विभाषी' },
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi / हिंदी' },
];

// One entry per label key: { en, hi }.
export const LABELS = {
  // Documents
  masterPlanningSheet: { en: 'Master Planning Sheet', hi: 'मास्टर प्लानिंग शीट' },
  jobCard: { en: 'Job Card', hi: 'जॉब कार्ड' },
  productionInstruction: { en: 'Production Instruction & Recording Sheet', hi: 'उत्पादन निर्देश एवं रिकॉर्डिंग शीट' },
  // Stages
  bunching: { en: 'Bunching', hi: 'बंचिंग' },
  coreExtrusion: { en: 'Core Extrusion', hi: 'कोर एक्सट्रूज़न' },
  laying: { en: 'Laying', hi: 'लेइंग' },
  sheathing: { en: 'Sheathing', hi: 'शीथिंग' },
  // Header
  planNumber: { en: 'Plan No.', hi: 'प्लान नंबर' },
  date: { en: 'Date', hi: 'तारीख' },
  operator: { en: 'Operator', hi: 'ऑपरेटर' },
  machine: { en: 'Machine', hi: 'मशीन' },
  customer: { en: 'Customer', hi: 'ग्राहक' },
  product: { en: 'Product', hi: 'उत्पाद' },
  cable: { en: 'Cable', hi: 'केबल' },
  cableType: { en: 'Cable Type', hi: 'केबल प्रकार' },
  department: { en: 'Department', hi: 'विभाग' },
  priority: { en: 'Priority', hi: 'प्राथमिकता' },
  deliveryDate: { en: 'Delivery Date', hi: 'डिलीवरी तारीख' },
  // Sections
  technicalData: { en: 'Technical Data', hi: 'तकनीकी जानकारी' },
  machineData: { en: 'Machine Data', hi: 'मशीन जानकारी' },
  operatorEntry: { en: 'Operator Entry', hi: 'ऑपरेटर एंट्री' },
  rejectionTracking: { en: 'Rejection', hi: 'रिजेक्शन' },
  downtimeTracking: { en: 'Downtime', hi: 'मशीन बंद समय' },
  targetVsActual: { en: 'Target vs Actual Efficiency', hi: 'लक्ष्य बनाम वास्तविक दक्षता' },
  machineLoading: { en: 'Machine Loading', hi: 'मशीन लोडिंग' },
  materialRequirement: { en: 'Material Requirement', hi: 'मटेरियल आवश्यकता' },
  departmentPlan: { en: 'Department-wise Plan', hi: 'विभागवार योजना' },
  // Technical fields
  size: { en: 'Size', hi: 'साइज़' },
  numberOfCores: { en: 'No. of Cores', hi: 'कोर संख्या' },
  colours: { en: 'Colours', hi: 'रंग' },
  length: { en: 'Length', hi: 'लंबाई' },
  numberOfStrands: { en: 'No. of Strands', hi: 'स्ट्रैंड संख्या' },
  strandDiameter: { en: 'Strand Dia', hi: 'स्ट्रैंड व्यास' },
  copperConstruction: { en: 'Copper Construction', hi: 'कॉपर कंस्ट्रक्शन' },
  copperArea: { en: 'Copper Area', hi: 'कॉपर एरिया' },
  coreColour: { en: 'Core Colour', hi: 'कोर रंग' },
  coreSize: { en: 'Core Size', hi: 'कोर साइज़' },
  coreOd: { en: 'Core OD', hi: 'कोर OD' },
  insulationThickness: { en: 'Insulation Thickness', hi: 'इन्सुलेशन मोटाई' },
  colourCombination: { en: 'Colour Combination', hi: 'रंग संयोजन' },
  layingLossPct: { en: 'Laying Loss %', hi: 'लेइंग लॉस %' },
  flatRound: { en: 'Flat / Round', hi: 'फ्लैट / राउंड' },
  finishedOd: { en: 'Finished OD', hi: 'फिनिश्ड OD' },
  wastagePct: { en: 'Wastage %', hi: 'वेस्टेज %' },
  requiredLength: { en: 'Required Length', hi: 'आवश्यक लंबाई' },
  requiredQuantity: { en: 'Required Quantity', hi: 'आवश्यक मात्रा' },
  targetLength: { en: 'Target Length', hi: 'लक्ष्य लंबाई' },
  targetProduction: { en: 'Target Production', hi: 'लक्ष्य उत्पादन' },
  // Machine fields
  machineCapacity: { en: 'Machine Capacity', hi: 'मशीन क्षमता' },
  expectedHours: { en: 'Expected Running Hours', hi: 'अनुमानित घंटे' },
  targetCompletion: { en: 'Target Completion', hi: 'पूर्णता समय' },
  utilization: { en: 'Utilization %', hi: 'उपयोग %' },
  requiredHours: { en: 'Required Hours', hi: 'आवश्यक घंटे' },
  // Operator entry
  actualProduction: { en: 'Actual Production', hi: 'वास्तविक उत्पादन' },
  actualLength: { en: 'Actual Length', hi: 'वास्तविक लंबाई' },
  actualCoreOd: { en: 'Actual Core OD', hi: 'वास्तविक कोर OD' },
  actualFinishedOd: { en: 'Actual Finished OD', hi: 'वास्तविक फिनिश्ड OD' },
  startTime: { en: 'Start Time', hi: 'शुरू समय' },
  endTime: { en: 'End Time', hi: 'समाप्त समय' },
  operatorSignature: { en: 'Operator Signature', hi: 'ऑपरेटर हस्ताक्षर' },
  supervisorSignature: { en: 'Supervisor Signature', hi: 'सुपरवाइज़र हस्ताक्षर' },
  remarks: { en: 'Remarks', hi: 'टिप्पणी' },
  // Rejection / downtime / efficiency
  rejectionQty: { en: 'Rejection Qty', hi: 'रिजेक्शन मात्रा' },
  rejectionPct: { en: 'Rejection %', hi: 'रिजेक्शन %' },
  downtimeMin: { en: 'Downtime (min)', hi: 'डाउनटाइम (मिनट)' },
  reason: { en: 'Reason', hi: 'कारण' },
  targetQuantity: { en: 'Target Quantity', hi: 'लक्ष्य मात्रा' },
  actualQuantity: { en: 'Actual Quantity', hi: 'वास्तविक मात्रा' },
  efficiencyPct: { en: 'Efficiency %', hi: 'दक्षता %' },
  downtimePct: { en: 'Downtime %', hi: 'डाउनटाइम %' },
  // Summary
  coreProductionLength: { en: 'Core Production Length', hi: 'कोर उत्पादन लंबाई' },
  bunchingLength: { en: 'Bunching Length', hi: 'बंचिंग लंबाई' },
  layingLength: { en: 'Laying Length', hi: 'लेइंग लंबाई' },
  sheathingLength: { en: 'Sheathing Length', hi: 'शीथिंग लंबाई' },
  totalPlannedLength: { en: 'Total Planned Length', hi: 'कुल नियोजित लंबाई' },
  finishedCableLength: { en: 'Finished Cable Length', hi: 'फिनिश्ड केबल लंबाई' },
  leadTime: { en: 'Lead Time', hi: 'लीड टाइम' },
  scanToUpdate: { en: 'Scan to update production', hi: 'उत्पादन अपडेट के लिए स्कैन करें' },
};

// Rejection reasons (printed as a tick-list on every job card).
export const REJECTION_REASONS = [
  { en: 'OD Variation', hi: 'OD भिन्नता' },
  { en: 'Colour Variation', hi: 'रंग भिन्नता' },
  { en: 'Joint', hi: 'जॉइंट' },
  { en: 'Breakage', hi: 'टूट-फूट' },
  { en: 'PVC Defect', hi: 'PVC दोष' },
  { en: 'Copper Defect', hi: 'कॉपर दोष' },
  { en: 'Machine Problem', hi: 'मशीन समस्या' },
  { en: 'Other', hi: 'अन्य' },
];

// Downtime reasons (printed as a tick-list on every job card).
export const DOWNTIME_REASONS = [
  { en: 'Material Not Available', hi: 'मटेरियल उपलब्ध नहीं' },
  { en: 'Machine Breakdown', hi: 'मशीन खराबी' },
  { en: 'Power Failure', hi: 'बिजली बंद' },
  { en: 'Setup Change', hi: 'सेटअप बदलाव' },
  { en: 'Tool Change', hi: 'टूल बदलाव' },
  { en: 'Operator Issue', hi: 'ऑपरेटर समस्या' },
  { en: 'Quality Issue', hi: 'क्वालिटी समस्या' },
  { en: 'Other', hi: 'अन्य' },
];

const both = (e, h) => (h ? `${e} / ${h}` : e);

/** Translate a single {en,hi} pair for the chosen language. */
export function tr(pair, lang = 'bilingual') {
  if (!pair) return '';
  if (lang === 'english') return pair.en;
  if (lang === 'hindi') return pair.hi || pair.en;
  return both(pair.en, pair.hi);
}

/** makeT(lang) → t(key) that looks the key up in LABELS and renders for lang. */
export function makeT(lang = 'bilingual') {
  return (key) => tr(LABELS[key] || { en: key, hi: '' }, lang);
}
