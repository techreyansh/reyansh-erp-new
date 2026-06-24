// Single source of truth for the ERP's module navigation.
// Consumed by SidebarNav (and anything else that needs the module tree).
// Adding a module = one entry here. Permission filtering is applied at render
// time via the PermissionContext + config/moduleAccess (path -> module key),
// exactly like the old Header did — so this file stays purely declarative.
import React from "react";
import {
  HomeOutlined,
  SpaceDashboardOutlined,
  SecurityOutlined,
  FactoryOutlined,
  GroupsOutlined,
  TrendingUpOutlined,
  PeopleAltOutlined,
  ForumOutlined,
  CampaignOutlined,
  InputOutlined,
  HelpOutlineOutlined,
  Inventory2Outlined,
  LocalShippingOutlined,
  ReceiptLongOutlined,
  ShoppingCartOutlined,
  StorefrontOutlined,
  AssignmentOutlined,
  ChecklistOutlined,
  FactCheckOutlined,
  AnalyticsOutlined,
  BadgeOutlined,
  PaymentsOutlined,
  CalculateOutlined,
  GridViewOutlined,
  FolderOutlined,
  SettingsOutlined,
  BuildOutlined,
  CableOutlined,
  PrecisionManufacturingOutlined,
  ShoppingBagOutlined,
  InsightsOutlined,
  AutoAwesomeOutlined,
  AccountTreeOutlined,
} from "@mui/icons-material";

const ic = (Comp) => <Comp sx={{ fontSize: 20 }} />;

// Each group: { key, label, icon, items: [{ label, path, icon, moduleKey?,
//   requireCreate?, requireEdit?, requireDelete? }] }.
// `path` may include a query string; matching/active-state handles that.
export const NAV_GROUPS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: ic(SpaceDashboardOutlined),
    items: [
      { label: "Home", path: "/home", icon: ic(HomeOutlined) },
      { label: "CEO Master Control", path: "/ceo-command", icon: ic(SecurityOutlined), moduleKey: "employees", requireEdit: true },
      { label: "Plant Command", path: "/plant-command", icon: ic(FactoryOutlined) },
      { label: "Operations Control Tower", path: "/operations-tower", icon: ic(InsightsOutlined) },
      { label: "Main Dashboard", path: "/dashboard", icon: ic(SpaceDashboardOutlined) },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    icon: ic(GroupsOutlined),
    items: [
      { label: "Daily Worklist", path: "/crm/worklist", icon: ic(AssignmentOutlined) },
      { label: "Team Performance", path: "/crm/team", icon: ic(GroupsOutlined) },
      { label: "Prospect Management", path: "/crm-pipeline?view=prospects", icon: ic(TrendingUpOutlined) },
      { label: "Client Pipeline", path: "/crm/client-pipeline", icon: ic(AccountTreeOutlined) },
      { label: "Payment Follow-Up", path: "/crm/payments", icon: ic(PaymentsOutlined) },
      { label: "Client Reports", path: "/crm/client-reports", icon: ic(AnalyticsOutlined) },
      { label: "CRM Dashboard", path: "/crm/dashboard", icon: ic(InsightsOutlined) },
      { label: "KIT — Keep In Touch", path: "/kit", icon: ic(ForumOutlined) },
      { label: "AI Sales Copilot", path: "/crm/copilot", icon: ic(AutoAwesomeOutlined) },
      { label: "Email Campaigns", path: "/crm/campaigns", icon: ic(CampaignOutlined) },
      { label: "Import CRM Data", path: "/crm-import", icon: ic(InputOutlined) },
      { label: "CRM Guide", path: "/crm/guide", icon: ic(HelpOutlineOutlined) },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: ic(TrendingUpOutlined),
    items: [
      { label: "Products", path: "/products", icon: ic(ShoppingBagOutlined) },
      { label: "Product Master (PLM)", path: "/product-master", icon: ic(Inventory2Outlined) },
      { label: "Sales Orders", path: "/sales-orders", icon: ic(ReceiptLongOutlined) },
      { label: "Demand Forecast", path: "/demand-forecast", icon: ic(InsightsOutlined) },
      { label: "Client Orders", path: "/client-orders", icon: ic(ReceiptLongOutlined) },
      { label: "Sales Order Ingestion", path: "/po-ingestion", icon: ic(InputOutlined) },
      { label: "Sales Flow", path: "/sales-flow", icon: ic(TrendingUpOutlined) },
      { label: "Payments / Collections", path: "/crm/collections", icon: ic(PaymentsOutlined) },
      { label: "Customer Portal", path: "/portal-admin", icon: ic(StorefrontOutlined) },
    ],
  },
  {
    key: "production",
    label: "Production",
    icon: ic(BuildOutlined),
    items: [
      { label: "Product Development (NPD)", path: "/npd", icon: ic(AutoAwesomeOutlined), moduleKey: "npd" },
      { label: "Production Planning", path: "/ppc", icon: ic(AssignmentOutlined) },
      { label: "Production Demand", path: "/production-demand", icon: ic(FactoryOutlined) },
      { label: "Cable Production", path: "/cable-production", icon: ic(CableOutlined) },
      { label: "Molding Production", path: "/molding", icon: ic(PrecisionManufacturingOutlined) },
      { label: "Production Log", path: "/production-log", icon: ic(GridViewOutlined) },
      { label: "Production Intelligence", path: "/production-intelligence", icon: ic(InsightsOutlined) },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    icon: ic(Inventory2Outlined),
    items: [
      { label: "Material Control", path: "/inventory-control", icon: ic(Inventory2Outlined) },
      { label: "Inventory (legacy)", path: "/inventory", icon: ic(Inventory2Outlined) },
      { label: "Material Requirements (MRP)", path: "/mrp", icon: ic(Inventory2Outlined) },
    ],
  },
  {
    key: "dispatch",
    label: "Dispatch",
    icon: ic(LocalShippingOutlined),
    items: [
      { label: "Dispatch Planning", path: "/dispatch", icon: ic(AssignmentOutlined) },
      { label: "Dispatch Control Tower", path: "/dispatch-control", icon: ic(LocalShippingOutlined) },
      { label: "Dispatch Management", path: "/dispatch-management", icon: ic(LocalShippingOutlined) },
      { label: "Order to Dispatch System", path: "/flow-management", icon: ic(AssignmentOutlined) },
    ],
  },
  {
    key: "purchase",
    label: "Purchase",
    icon: ic(ShoppingCartOutlined),
    items: [
      { label: "Purchase Requisitions", path: "/purchase-requisitions", icon: ic(ReceiptLongOutlined) },
      { label: "Purchase Flow", path: "/purchase-flow", icon: ic(ShoppingCartOutlined) },
      { label: "Vendors", path: "/vendor-management", icon: ic(StorefrontOutlined) },
    ],
  },
  {
    key: "tasks",
    label: "Tasks & Checklists",
    icon: ic(ChecklistOutlined),
    items: [
      { label: "Task Scheduler", path: "/task-scheduler", icon: ic(AssignmentOutlined), moduleKey: "tasks", requireCreate: true },
      { label: "Team Tasks", path: "/team-tasks", icon: ic(AssignmentOutlined), moduleKey: "tasks", requireEdit: true },
      { label: "My Tasks", path: "/my-tasks", icon: ic(AssignmentOutlined), moduleKey: "tasks" },
      { label: "My Checklist", path: "/task-checklist", icon: ic(ChecklistOutlined) },
      { label: "Checklist Templates", path: "/checklist-templates", icon: ic(FactCheckOutlined), moduleKey: "tasks", requireEdit: true },
      { label: "Checklist Compliance", path: "/task-compliance-admin", icon: ic(FactCheckOutlined), moduleKey: "tasks", requireEdit: true },
    ],
  },
  {
    key: "hr",
    label: "HR & Performance",
    icon: ic(BadgeOutlined),
    items: [
      { label: "Employee Management", path: "/employee-management", icon: ic(BadgeOutlined), moduleKey: "employees", requireEdit: true },
      { label: "Performance Review", path: "/performance", icon: ic(TrendingUpOutlined) },
      { label: "MIS Home", path: "/mis", icon: ic(AnalyticsOutlined) },
    ],
  },
  {
    key: "accounts",
    label: "Accounts",
    icon: ic(CalculateOutlined),
    items: [
      { label: "Cost Control", path: "/cost-control", icon: ic(CalculateOutlined) },
      { label: "Invoicing", path: "/invoicing", icon: ic(ReceiptLongOutlined) },
      { label: "Costing Calculator", path: "/costing", icon: ic(CalculateOutlined) },
    ],
  },
  {
    key: "temporary",
    label: "Temporary",
    icon: ic(BuildOutlined),
    items: [
      { label: "Cable Planning Workbench", path: "/temp/cable-planning", icon: ic(CableOutlined) },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    icon: ic(SettingsOutlined),
    items: [
      { label: "Master Data Hub", path: "/master-data", icon: ic(GridViewOutlined), moduleKey: "employees", requireEdit: true },
      { label: "View as User", path: "/access-preview", icon: ic(GroupsOutlined), moduleKey: "employees", requireEdit: true },
      { label: "Document Library", path: "/document-library", icon: ic(FolderOutlined) },
      { label: "Setup Sheets", path: "/setup-sheets", icon: ic(SettingsOutlined) },
      { label: "Troubleshoot", path: "/troubleshoot-sheets", icon: ic(BuildOutlined) },
    ],
  },
];

// Flat list of every navigable item (for module search + favorites/recents lookup).
export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, groupKey: g.key, groupLabel: g.label }))
);

// Normalise a path for active-state comparison (strip query + trailing slash).
export function basePath(path) {
  return (path || "").split("?")[0].replace(/\/+$/, "") || "/";
}
