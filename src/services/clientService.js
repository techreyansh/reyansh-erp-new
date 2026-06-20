import config from '../config/config';
import { parseJsonArray } from '../utils/parseJsonField';
import { sheetInt, sheetFloat } from '../utils/sheetNumbers';
import { supabase } from '../lib/supabaseClient';

/**
 * CRM CONSOLIDATION (Phase 1): client reads/writes now go to the unified master.
 * Reads come from the compat VIEW public.v_clients_compat (CLIENT accounts exposed
 * in the old clients2 PascalCase column shape). Writes (add/update/delete) target the
 * crm_pipeline master directly. The clients2 table is no longer used here.
 *
 * Legacy mapping kept for reference only:
 * Physical legacy table was public.clients2; logical CLIENT/clients → clients2.
 */
const TABLE_MAPPINGS = {
  clients: 'clients2',        // Legacy logical → physical (no longer read)
  CLIENT: 'clients2',         // Config key → physical (no longer read)
};

/** Compat view exposing CLIENT-type crm_pipeline accounts in the clients2 column shape. */
const CLIENTS_COMPAT_VIEW = 'v_clients_compat';
/** Master table backing all client writes. */
const CRM_PIPELINE_TABLE = 'crm_pipeline';

/** Logical key from config (kept for reference; reads now use the compat view). */
const CLIENTS_LOGICAL = config.sheets.clients;  // Should be 'CLIENT'

console.log('[clientService] STARTUP - reading clients from crm_pipeline master', {
  'config.sheets.clients': CLIENTS_LOGICAL,
  'read source (view)': CLIENTS_COMPAT_VIEW,
  'write target (master)': CRM_PIPELINE_TABLE,
  'TABLE_MAPPINGS (legacy)': TABLE_MAPPINGS,
  timestamp: new Date().toISOString(),
});

// Generate unique client code sequentially (C + 5 digits, e.g., C00001)
// Sequence is derived from crm_pipeline.customer_code where customer_code ILIKE 'C%'.
export async function generateSequentialClientCode() {
  const { data, error } = await supabase
    .from(CRM_PIPELINE_TABLE)
    .select('customer_code')
    .ilike('customer_code', 'C%');
  const rows = error ? [] : (Array.isArray(data) ? data : []);
  const max = rows.reduce((acc, row) => {
    const code = row.customer_code || '';
    const match = code.match(/^C(\d{5})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > acc ? num : acc;
    }
    return acc;
  }, 0);
  const next = (max + 1).toString().padStart(5, '0');
  return `C${next}`;
}

export async function checkClientCodeExists(clientCode) {
  if (!clientCode) return false;
  const { data, error } = await supabase
    .from(CRM_PIPELINE_TABLE)
    .select('customer_code')
    .eq('customer_code', clientCode)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function getAllClients(forceRefresh = false) {
  try {
    console.log("[getAllClients] START", { forceRefresh, source: CLIENTS_COMPAT_VIEW });

    const { data, error } = await supabase.from(CLIENTS_COMPAT_VIEW).select('*');
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const mapped = rows.map((row) => ({
      ...row,
      // Basic Information
      clientName: row.ClientName || '',
      clientCode: row.ClientCode || '',
      businessType: row.BusinessType || '',

      // Contact Information
      address: row.Address || '',
      city: row.City || '',
      state: row.State || '',
      stateCode: row.StateCode || '',
      pincode: row.Pincode || '',
      country: row.Country || 'India',

      // Business Details
      gstin: row.GSTIN || '',
      panNumber: row.PANNumber || '',
      accountCode: row.AccountCode || '',
      website: row.Website || '',

      // Contact Management
      contacts: parseJsonArray(row.Contacts),

      // Business Terms
      paymentTerms: row.PaymentTerms || '',
      creditLimit: row.CreditLimit || '',
      creditPeriod: row.CreditPeriod || '',
      deliveryTerms: row.DeliveryTerms || '',

      // Product Information
      products: parseJsonArray(row.Products),

      // Additional Information
      notes: row.Notes || '',
      status: row.Status || 'Active',
      rating: parseInt(row.Rating, 10) || 0,
      lastContactDate: row.LastContactDate || '',
      totalOrders: parseInt(row.TotalOrders, 10) || 0,
      totalValue: parseFloat(row.TotalValue) || 0,
    }));

    console.log("[getAllClients] SUCCESS", { count: mapped.length });
    return mapped;
  } catch (error) {
    console.error("[getAllClients] ERROR:", error);
    throw error;
  }
}

/** Map a camelCase client object to crm_pipeline master columns (client account). */
function toMasterClientRow(client) {
  return {
    company_name: client.clientName || '',
    customer_code: client.clientCode || '',
    account_type: 'client',
    client_stage: 'active',
    kind: 'recurring',
    stage: 'recurring_client',
    business_type: client.businessType || '',
    gstin: client.gstin || '',
    pan: client.panNumber || '',
    city: client.city || '',
    industry: client.industry || null,
    payment_terms: client.paymentTerms || '',
    credit_limit: sheetFloat(client.creditLimit, 0),
    credit_period: client.creditPeriod || '',
    delivery_terms: client.deliveryTerms || '',
    website: client.website || '',
    notes: client.notes || '',
    rating: String(client.rating || 0),
    total_value: client.totalValue || 0,
    total_orders: client.totalOrders || 0,
  };
}

export async function addClient(client) {
  console.log("[addClient] Starting add operation", { clientCode: client.clientCode });

  try {
    // Check if client code already exists
    if (client.clientCode && await checkClientCodeExists(client.clientCode)) {
      throw new Error('Client code already exists. Please use a different client code.');
    }

    const row = toMasterClientRow(client);

    console.log("[addClient] Inserting master client row", { rowKeys: Object.keys(row) });
    const { data, error } = await supabase
      .from(CRM_PIPELINE_TABLE)
      .insert(row)
      .select()
      .single();

    if (error) {
      // crm_pipeline has a UNIQUE index on lower(company_name). On conflict, a
      // lead→client creation should UPGRADE the existing prospect row rather than throw.
      if (error.code === '23505') {
        console.log("[addClient] Unique company_name conflict — upgrading existing row", { name: client.clientName });
        const { data: updated, error: updErr } = await supabase
          .from(CRM_PIPELINE_TABLE)
          .update(row)
          .ilike('company_name', client.clientName || '')
          .select()
          .single();
        if (updErr) throw updErr;
        console.log("[addClient] ✅ SUCCESS: existing row upgraded to client", { clientCode: client.clientCode });
        return updated;
      }
      throw error;
    }

    console.log("[addClient] ✅ SUCCESS: Client added", { clientCode: client.clientCode });
    return data;
  } catch (error) {
    console.error("[addClient] ❌ ERROR:", error.message, error);
    throw error;
  }
}

export async function updateClient(client, originalClientCode = null) {
  console.log("[updateClient] Starting update operation", { clientCode: client.clientCode, originalCode: originalClientCode });
  
  try {
    // Check if the new client code already exists (and it's not the same as the original)
    if (client.clientCode && originalClientCode && client.clientCode !== originalClientCode) {
      if (await checkClientCodeExists(client.clientCode)) {
        throw new Error('Client code already exists. Please use a different client code.');
      }
    }
    
    const matchCode = originalClientCode || client.clientCode;
    if (!matchCode) throw new Error('Client not found');

    const row = toMasterClientRow(client);

    console.log("[updateClient] Updating master client", { matchCode, rowKeys: Object.keys(row) });
    const { error } = await supabase
      .from(CRM_PIPELINE_TABLE)
      .update(row)
      .eq('customer_code', matchCode);
    if (error) throw error;
    console.log("[updateClient] ✅ SUCCESS: Client updated", { clientCode: client.clientCode });
  } catch (error) {
    console.error("[updateClient] ❌ ERROR:", error.message, error);
    throw error;
  }
}

// UUID v4-ish detector to decide whether to match by id or by customer_code.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteClient(clientOrId) {
  console.log("[deleteClient] Starting delete operation", { clientOrId });

  try {
    // Resolve to either an id (uuid) or a customer_code (C*), preferring an explicit id.
    let id = null;
    let code = null;
    if (typeof clientOrId === 'object' && clientOrId !== null) {
      id = clientOrId.id || null;
      code = clientOrId.ClientCode || clientOrId.clientCode || clientOrId.customer_code || null;
    } else if (typeof clientOrId === 'string') {
      if (UUID_RE.test(clientOrId)) id = clientOrId;
      else code = clientOrId;
    }

    let query = supabase.from(CRM_PIPELINE_TABLE).delete();
    if (id) {
      query = query.eq('id', id);
    } else if (code) {
      query = query.eq('customer_code', code);
    } else {
      throw new Error('Client not found');
    }

    const { error } = await query;
    if (error) throw error;
    console.log("[deleteClient] ✅ SUCCESS: Client deleted", { id, code });
  } catch (error) {
    console.error("[deleteClient] ❌ ERROR:", error.message, error);
    throw error;
  }
}

// Get all unique products from all clients
export async function getAllProductsFromClients(forceRefresh = false) {
  try {
    const clients = await getAllClients(forceRefresh);
    const productMap = new Map(); // Use Map to ensure uniqueness by productCode
    
    for (const client of clients) {

      if (client.products && Array.isArray(client.products)) {
        client.products.forEach((product, index) => {
          if (product.productCode) {
            // If product code already exists, keep the first occurrence
            if (!productMap.has(product.productCode)) {
              productMap.set(product.productCode, {
                productCode: product.productCode,
                productName: product.productName || '',
                category: product.category || '',
                description: product.description || '',
                // Technical specifications
                conductorSize: product.conductorSize || '',
                strandCount: product.strandCount || '',
                numberOfCore: product.numberOfCore || '',
                coreColors: product.coreColors || [],
                // Also include the colour field directly
                colour: product.colour || '',
                coreOD: product.coreOD || '',
                corePVC: product.corePVC || '',
                sheathOD: product.sheathOD || '',
                sheathInnerPVC: product.sheathInnerPVC || '',
                sheathOuterPVC: product.sheathOuterPVC || '',
                printingMaterial: product.printingMaterial || '',
                totalLength: product.totalLength || '',
                colour: product.colour || '',
                // Stock-related fields
                currentStock: product.currentStock || '',
                minLevel: product.minLevel || '',
                maxLevel: product.maxLevel || '',
                reorderPoint: product.reorderPoint || '',
                unit: product.unit || '',
                location: product.location || '',
                lastUpdated: product.lastUpdated || '',
                status: product.status || 'Active',
                clientCode: client.clientCode,
                clientName: client.clientName,
                // Store reference to client for traceability
                sourceClient: {
                  clientCode: client.clientCode,
                  clientName: client.clientName
                }
              });
            } else {
            }
          } else {
          }
        });
      } else {
      }
    }
    
    // Convert Map to array and sort by product code
    const result = Array.from(productMap.values()).sort((a, b) => 
      a.productCode.localeCompare(b.productCode)
    );

    return result;
  } catch (error) {
    console.error('=== GET ALL PRODUCTS FROM CLIENTS ERROR ===');
    console.error('Error getting products from clients:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

// Create a new client from sales flow data
export async function createClientFromSalesFlow(salesFlowData, leadDetails) {
  try {
    // Generate unique client code sequentially
    const clientCode = await generateSequentialClientCode();
    
    // Extract contact information from lead details
    const contacts = [];
    if (leadDetails?.ContactPerson) {
      contacts.push({
        name: leadDetails.ContactPerson,
        email: leadDetails.EmailId || salesFlowData.Email,
        number: leadDetails.MobileNumber || salesFlowData.PhoneNumber,
        department: leadDetails.Department || 'General'
      });
    }
    
    // Extract products interested
    const products = [];
    if (leadDetails?.ProductsInterested) {
      try {
        const productsInterested = typeof leadDetails.ProductsInterested === 'string' 
          ? JSON.parse(leadDetails.ProductsInterested) 
          : leadDetails.ProductsInterested;
        
        if (Array.isArray(productsInterested)) {
          productsInterested.forEach(product => {
            // Handle both object format and string format
            if (typeof product === 'object' && (product.productCode || product.ProductCode)) {
              products.push({
                productCode: product.productCode || product.ProductCode
              });
            } else if (typeof product === 'string') {
              products.push({
                productCode: product
              });
            }
          });
        }
      } catch (err) {
        console.error('Error parsing products interested:', err);
      }
    }
    
    // Create client object
    const client = {
      clientName: leadDetails?.CompanyName || salesFlowData.CompanyName || salesFlowData.FullName,
      clientCode: clientCode,
      address: leadDetails?.CustomerLocation || salesFlowData.CustomerLocation || '',
      contacts: contacts,
      products: products
    };
    
    // Add to CLIENT sheet
    await addClient(client);
    
    return {
      success: true,
      client: client,
      message: 'Client created successfully'
    };
  } catch (error) {
    console.error('Error creating client from sales flow:', error);
    throw error;
  }
}
