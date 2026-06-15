import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Container } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import ModuleTablePage from "../../components/common/ModuleTablePage";
import DealsKanban from "../../components/crm/DealsKanban";
import CRMEnterprisePanels from "../../components/crm/CRMEnterprisePanels";
import CRMDashboard from "../../components/crm/CRMDashboard";
import CRMFlowStrip from "../../components/crm/CRMFlowStrip";
import CRMGuide from "../../components/crm/CRMGuide";
import EmailCampaignsModule from "../../components/crm/email/EmailCampaignsModule";
import { crmMock, crmPpcLookups } from "../../data/mock/crmPpcData";
import { useEnterpriseERPStore } from "../../hooks/useEnterpriseERPStore";
import crmPpcBackendService from "../../services/crmPpcBackendService";
import { getCrmData } from "../../services/crmDataService";
import useCrmPpcRealtime from "../../hooks/useCrmPpcRealtime";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const CRMModulePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const section = location.pathname.split("/")[2] || "dashboard";

  const [loading, setLoading] = useState(true);
  const [crm, setCrm] = useState(null);
  const [followUps, setFollowUps] = useState(crmMock.followUps);
  const [deals] = useState(crmMock.deals);

  const customers = crm?.customers || [];
  const enterpriseStore = useEnterpriseERPStore({ customers });

  const loadCrm = useCallback(async () => {
    try {
      const data = await getCrmData();
      setCrm(data);
    } catch (e) {
      console.error("[CRMModulePage] Failed to load CRM data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCrm();
  }, [loadCrm]);

  // Light refresh when navigating between sections so data stays in sync with the ERP.
  useEffect(() => {
    if (crm) loadCrm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  useCrmPpcRealtime({
    onLeadChange: () => loadCrm(),
  });

  const statusColor = (status) => {
    const s = String(status).toLowerCase();
    if (/won|completed|qualified|on time|paid|delivered|active/.test(s)) return "success";
    if (/lost|overdue|expired|cancel|reject/.test(s)) return "error";
    if (/contacted|scheduled|pending|new|hold|sent|draft/.test(s)) return "warning";
    if (/progress|production/.test(s)) return "info";
    return "default";
  };

  const config = useMemo(() => ({
    leads: {
      title: "Leads",
      breadcrumbItems: ["CRM", "Leads"],
      columns: [
        { key: "companyName", label: "Company Name" },
        { key: "contactPerson", label: "Contact Person", hideBelow: "md" },
        { key: "phone", label: "Phone", hideBelow: "md" },
        { key: "email", label: "Email", hideBelow: "md" },
        { key: "source", label: "Source", hideBelow: "md" },
        { key: "productInterest", label: "Product Interest", hideBelow: "md" },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
        { key: "score", label: "Score", hideBelow: "md" },
        { key: "category", label: "Category", type: "status", getColor: (v) => (v === "Hot" ? "error" : v === "Warm" ? "warning" : "info") },
        { key: "assignedSalesperson", label: "Assigned To", hideBelow: "md" },
        { key: "createdDate", label: "Created", hideBelow: "md" },
      ],
      formFields: [
        { key: "companyName", label: "Company Name", type: "text", required: true },
        { key: "contactPerson", label: "Contact Person", type: "text", required: true },
        { key: "phone", label: "Phone", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "source", label: "Lead Source", type: "select", options: crmPpcLookups.leadSources },
        { key: "productInterest", label: "Product Interest", type: "text" },
        { key: "priority", label: "Priority", type: "select", options: crmPpcLookups.priorities },
        { key: "assignedSalesperson", label: "Assign To", type: "text" },
        { key: "status", label: "Status", type: "select", options: crmPpcLookups.leadStatuses },
      ],
      data: crm?.leads || [],
      idPrefix: "LD",
      defaultSortBy: "createdDate",
      defaultSortDirection: "desc",
      onSaveRow: crmPpcBackendService.upsertLead,
      onDeleteRow: (row) => crmPpcBackendService.deleteLead(row.id),
    },
    customers: {
      title: "Customers",
      breadcrumbItems: ["CRM", "Customers"],
      columns: [
        { key: "code", label: "Code", hideBelow: "md" },
        { key: "companyName", label: "Company Name" },
        { key: "gstNumber", label: "GSTIN", hideBelow: "md" },
        { key: "contactPerson", label: "Contact", hideBelow: "md" },
        { key: "phone", label: "Phone", hideBelow: "md" },
        { key: "city", label: "City", hideBelow: "md" },
        { key: "state", label: "State", hideBelow: "md" },
        { key: "activeOrders", label: "Active Orders", hideBelow: "md" },
        { key: "totalValueFmt", label: "Total Value" },
        { key: "outstandingFmt", label: "Outstanding", hideBelow: "md" },
        { key: "paymentStatus", label: "Payment", type: "status", getColor: statusColor },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
      ],
      formFields: [
        { key: "companyName", label: "Company Name", type: "text", required: true },
        { key: "gstNumber", label: "GSTIN", type: "text" },
        { key: "contactPerson", label: "Contact Person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "city", label: "City", type: "text" },
        { key: "state", label: "State", type: "text" },
        { key: "creditLimit", label: "Credit Limit", type: "number" },
      ],
      data: (crm?.customers || []).map((c) => ({
        ...c,
        totalValueFmt: inr(c.totalValue),
        outstandingFmt: inr(c.outstandingAmount),
      })),
      formFields: [],
      idPrefix: "CUS",
      readOnly: true,
    },
    quotations: {
      title: "Quotations",
      breadcrumbItems: ["CRM", "Quotations"],
      columns: [
        { key: "quotationNumber", label: "Quotation #" },
        { key: "client", label: "Client" },
        { key: "issueDate", label: "Issued", hideBelow: "md" },
        { key: "validUntil", label: "Valid Until", hideBelow: "md" },
        { key: "amountFmt", label: "Amount" },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
      ],
      data: (crm?.quotations || []).map((q) => ({ ...q, amountFmt: inr(q.amount) })),
      formFields: [],
      idPrefix: "QT",
      defaultSortBy: "issueDate",
      defaultSortDirection: "desc",
      readOnly: true,
    },
    "sales-orders": {
      title: "Sales Orders",
      breadcrumbItems: ["CRM", "Sales Orders"],
      columns: [
        { key: "orderNumber", label: "Order #" },
        { key: "client", label: "Client" },
        { key: "orderDate", label: "Order Date", hideBelow: "md" },
        { key: "items", label: "Items", hideBelow: "md" },
        { key: "amountFmt", label: "Amount" },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
      ],
      data: (crm?.salesOrders || []).map((o) => ({ ...o, amountFmt: inr(o.amount) })),
      formFields: [],
      idPrefix: "SO",
      defaultSortBy: "orderDate",
      defaultSortDirection: "desc",
      readOnly: true,
    },
    collections: {
      title: "Collections",
      breadcrumbItems: ["CRM", "Collections"],
      columns: [
        { key: "client", label: "Client" },
        { key: "orderId", label: "Order", hideBelow: "md" },
        { key: "amountFmt", label: "Amount" },
        { key: "method", label: "Method", hideBelow: "md" },
        { key: "date", label: "Date", hideBelow: "md" },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
      ],
      data: (crm?.collections || []).map((p) => ({ ...p, amountFmt: inr(p.amount) })),
      formFields: [],
      idPrefix: "PAY",
      defaultSortBy: "date",
      defaultSortDirection: "desc",
      readOnly: true,
    },
    "follow-ups": {
      title: "Follow-ups",
      breadcrumbItems: ["CRM", "Follow-ups"],
      columns: [
        { key: "id", label: "Follow-up ID", hideBelow: "md" },
        { key: "leadCustomerName", label: "Lead/Customer Name" },
        { key: "date", label: "Date", hideBelow: "md" },
        { key: "type", label: "Type", hideBelow: "md" },
        { key: "notes", label: "Notes", hideBelow: "md" },
        { key: "nextFollowUpDate", label: "Next Follow-up Date", hideBelow: "md" },
        { key: "status", label: "Status", type: "status", getColor: statusColor },
      ],
      formFields: [
        { key: "leadCustomerName", label: "Select Lead/Customer", type: "text", required: true },
        { key: "type", label: "Follow-up Type", type: "select", options: crmPpcLookups.followupTypes, required: true },
        { key: "notes", label: "Notes", type: "textarea", required: true },
        { key: "nextFollowUpDate", label: "Next Follow-up Date", type: "date", required: true },
        { key: "date", label: "Date", type: "date", required: true },
        { key: "status", label: "Status", type: "select", options: ["Scheduled", "Completed"], required: true },
      ],
      data: followUps,
      setData: setFollowUps,
      idPrefix: "FU",
    },
  }), [crm, followUps]);

  // CRM onboarding / playbook
  if (section === "guide") {
    return <CRMGuide />;
  }

  // Email Campaigns — AI-personalized outreach sequences sent from Gmail
  if (section === "campaigns") {
    return <EmailCampaignsModule />;
  }

  // CRM dashboard (overview)
  if (section === "dashboard") {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 1 }}>
          <CRMFlowStrip current={section} />
          <CRMDashboard data={crm} loading={loading} />
        </Box>
      </Container>
    );
  }

  if (section === "deals") {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 1 }}>
          <CRMFlowStrip current={section} />
          <DealsKanban deals={deals} />
        </Box>
      </Container>
    );
  }

  // Enterprise analytical panels fed with LIVE crm data
  const enterpriseSections = ["lead-scoring", "timeline", "customer-360", "documents", "performance"];
  if (enterpriseSections.includes(section)) {
    return (
      <Container maxWidth="xl">
        <Box sx={{ py: 1 }}>
          <CRMFlowStrip current={section} />
          <CRMEnterprisePanels
            section={section}
            leads={crm?.leads || []}
            customers={crm?.customers || []}
            productionPlan={[]}
            enterprise={enterpriseStore.state}
            addEnterpriseRecord={enterpriseStore.appendRecord}
            updateEnterpriseRecords={enterpriseStore.updateRecords}
            setRole={enterpriseStore.setRole}
          />
        </Box>
      </Container>
    );
  }

  const selectedConfig = config[section];
  if (!selectedConfig) {
    navigate("/crm/dashboard");
    return null;
  }

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 1 }}>
        <CRMFlowStrip current={section} />
        <ModuleTablePage
          {...selectedConfig}
          loading={loading}
          onSaveRow={selectedConfig.onSaveRow}
          onDeleteRow={selectedConfig.onDeleteRow}
        />
      </Box>
    </Container>
  );
};

export default CRMModulePage;
