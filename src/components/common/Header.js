import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Box,
  useMediaQuery,
  useTheme,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Chip,
  Tooltip,
  Badge,
  Dialog,
  DialogContent,
  TextField,
  InputAdornment,
  Paper,
  Skeleton,
  Collapse,
  ListSubheader,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard,
  ListAlt,
  Assignment,
  Person,
  ExitToApp,
  Storage,
  TableChart,
  BugReport as DebugIcon,
  Inventory as ProductIcon,
  Inventory2 as InventoryIcon,
  ShoppingCart as PurchaseIcon,
  Calculate as CostingIcon,
  Receipt as OrderIcon,
  Cable as CableIcon,
  Build as ProductionIcon,
  People as EmployeeIcon,
  ArrowDropDown,
  Settings,
  Help,
  Search,
  Input,
  Group as PeopleIcon,
  Business,
  MoreVert,
  Message,
  LocalShipping,
  Help as HelpIcon,
  ContactMail as CRMIcon,
  Security as SecurityIcon,
  TrendingUp,
  Analytics,
  DarkModeOutlined,
  HomeOutlined,
  GridOnOutlined,
  LightModeOutlined,
  ExpandLess,
  ExpandMore,
  MarkEmailRead as CampaignIcon,
} from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../context/PermissionContext";
import { getModuleKeyForPath } from "../../config/moduleAccess";
import { useThemeMode } from "../../context/ThemeModeContext";
import config from "../../config/config";

const Header = () => {
  const theme = useTheme();
  const { mode, toggleMode } = useThemeMode();
  const { user, signOut, role: userRole } = useAuth();
  const permissions = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const isCompactNav = useMediaQuery(theme.breakpoints.down("lg"));
  const subtleHoverBg = theme.palette.mode === "dark" ? "rgba(148, 163, 184, 0.12)" : theme.palette.grey[100];

  const [anchorEl, setAnchorEl] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileMenuAnchor, setProfileMenuAnchor] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openSections, setOpenSections] = useState({});

  const toggleSection = (key) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleMenuOpen = (event, menuKey) => {
    setAnchorEl(prev => ({ ...prev, [menuKey]: event.currentTarget }));
  };

  const handleMenuClose = (menuKey) => {
    setAnchorEl(prev => ({ ...prev, [menuKey]: null }));
  };

  const handleProfileMenu = (event) => {
    setProfileMenuAnchor(event.currentTarget);
  };

  const handleProfileMenuClose = () => {
    setProfileMenuAnchor(null);
  };

  const handleSignOut = async () => {
    handleProfileMenuClose();
    await signOut();
  };

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const handleSearchOpen = () => {
    setSearchOpen(true);
    setSearchQuery("");
  };

  const handleSearchClose = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const handleSearchNavigate = (path) => {
    navigate(path);
    handleSearchClose();
  };

  // Keyboard shortcut for search (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        handleSearchOpen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const canManageEmployees = permissions.canManageEmployees;

  /** Roles that can open CRM / PPC module menus (aligns with operational teams). */
  const crmModuleRoles = [
    "CEO",
    "Customer Relations Manager",
    "Sales Executive",
    "Director",
    "NPD",
    "Store Manager",
    "Process Coordinator",
    "Production Manager",
    "QC Manager",
    "Quality Engineer",
    "Cable Production Supervisor",
    "Moulding Production Supervisor",
    "Management / HOD",
    "Accounts Executive",
  ];

  const ppcModuleRoles = [
    "CEO",
    "Production Manager",
    "Store Manager",
    "Process Coordinator",
    "Customer Relations Manager",
    "QC Manager",
    "Quality Engineer",
    "Cable Production Supervisor",
    "Moulding Production Supervisor",
    "Management / HOD",
    "Purchase Executive",
    "Sales Executive",
  ];

  /**
   * ROLE-BASED ACCESS CONTROL CONFIGURATION
   * 
   * Available Roles:
   * - CEO: Full access (100% - all modules)
   * - Customer Relations Manager: High access (70% - sales, clients, dispatch, CRM)
   * - Store Manager: High access (65% - inventory, operations, purchase flow)
   * - QC Manager: Moderate access (45% - quality control, material inspection)
   * - Process Coordinator: Moderate access (40% - purchase coordination, order dispatch)
   * - Sales Executive: Moderate access (35% - sales operations, client management)
   * - Production Manager: Limited access (20% - production workflows)
   * - NPD: Limited access (15% - product feasibility)
   * 
   * Access Rules:
   * - CEO has access to ALL items regardless of roles array
   * - Items with roles: ["all"] are accessible to all authenticated users
   * - Other roles must be explicitly listed in the roles array
   * 
   * For detailed documentation, see: ROLE_ACCESS_DOCUMENTATION.md
   */
  const menuGroups = [
    {
      key: "dashboard",
      label: "Overview",
      icon: <Dashboard />,
      items: [
        {
          label: "Home",
          path: "/home",
          icon: <HomeOutlined />,
          roles: ["all"],
        },
        {
          subheader: "Command Centers",
          label: "CEO Master Control",
          path: "/ceo-command",
          icon: <SecurityIcon />,
          roles: ["CEO"],
        },
        {
          subheader: "Command Centers",
          label: "Plant Command",
          path: "/plant-command",
          icon: <Dashboard />,
          roles: [
            "CEO",
            "Production Manager",
            "Process Coordinator",
            "QC Manager",
            "Cable Production Supervisor",
            "Moulding Production Supervisor",
            "Management/HOD",
          ],
        },
        {
          subheader: "Command Centers",
          label: "Main Dashboard",
          path: "/dashboard",
          icon: <Dashboard />,
          roles: ["CEO", "Process Coordinator"],
        },
        {
          subheader: "Dashboards",
          label: "Employee Dashboard",
          path: "/employee-dashboard",
          icon: <EmployeeIcon />,
          roles: ["CEO", "HR Manager"],
        },
        {
          subheader: "Dashboards",
          label: "Client Dashboard",
          path: "/client-dashboard",
          icon: <Dashboard />,
          roles: ["Customer Relations Manager", "CEO", "Store Manager"],
        },
        {
          subheader: "Accountability",
          label: "My Scorecard",
          path: "/accountability",
          icon: <SecurityIcon />,
          roles: ["all"],
        },
        {
          subheader: "Operations",
          label: "Production Log",
          path: "/production-log",
          icon: <GridOnOutlined />,
          roles: [
            "CEO",
            "Production Manager",
            "Process Coordinator",
            "QC Manager",
            "Store Manager",
            "Cable Production Supervisor",
            "Moulding Production Supervisor",
            "Management/HOD",
          ],
        },
        {
          subheader: "Tasks",
          label: "Task Scheduler",
          path: "/task-scheduler",
          icon: <Assignment />,
          moduleKey: "tasks",
          requireCreate: true,
        },
        {
          subheader: "Tasks",
          label: "Team Tasks",
          path: "/team-tasks",
          icon: <Assignment />,
          moduleKey: "tasks",
          requireEdit: true,
        },
        {
          subheader: "Tasks",
          label: "My Tasks",
          path: "/my-tasks",
          icon: <Assignment />,
          moduleKey: "tasks",
        },
        {
          subheader: "Admin & Finance",
          label: "Employee Access Management",
          path: "/access-management",
          icon: <SecurityIcon />,
          roles: ["CEO"],
        },
        {
          subheader: "Admin & Finance",
          label: "Costing",
          path: "/costing",
          icon: <CostingIcon />,
          roles: ["CEO"],
        },
      ],
    },
    {
      key: "management",
      label: "Sales & Operations",
      icon: <Business />,
      items: [
        {
          subheader: "Sales & Clients",
          label: "Products",
          path: "/products",
          icon: <ProductIcon />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Sales & Clients",
          label: "Clients",
          path: "/clients",
          icon: <ListAlt />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Sales & Clients",
          label: "Prospects Clients",
          path: "/prospects-clients",
          icon: <ListAlt />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Sales & Clients",
          label: "Client Orders",
          path: "/client-orders",
          icon: <OrderIcon />,
          roles: ["Customer Relations Manager", "Sales Executive", "CEO"],
        },
        {
          subheader: "Sales & Clients",
          label: "Sales Order Ingestion",
          path: "/po-ingestion",
          icon: <Input />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Inventory & Dispatch",
          label: "Inventory",
          path: "/inventory",
          icon: <InventoryIcon />,
          roles: ["Store Manager", "CEO"],
        },
        {
          subheader: "Inventory & Dispatch",
          label: "Dispatch Planning",
          path: "/dispatch",
          icon: <Assignment />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Inventory & Dispatch",
          label: "Dispatch Management",
          path: "/dispatch-management",
          icon: <LocalShipping />,
          roles: ["Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Inventory & Dispatch",
          label: "Order to Dispatch System",
          path: "/flow-management",
          icon: <Assignment />,
          roles: ["Store Manager", "Cable Production Supervisor", "Moulding Production Supervisor", "QC Manager", "Process Coordinator", "Customer Relations Manager", "CEO"],
        },
        {
          subheader: "Procurement",
          label: "Vendors",
          path: "/vendor-management",
          icon: <Business />,
          roles: ["CEO", "Purchase Executive", "Management / HOD"],
        },
        {
          subheader: "Procurement",
          label: "Purchase Flow",
          path: "/purchase-flow",
          icon: <PurchaseIcon />,
          roles: ["Process Coordinator", "Purchase Executive", "Management / HOD", "Store Manager", "QC Manager", "Accounts Executive", "CEO"],
        },
        {
          subheader: "Documents",
          label: "Document Library",
          path: "/document-library",
          icon: <Storage />,
          roles: ["CEO"],
        },
        {
          subheader: "Tasks",
          label: "Task Checklist",
          path: "/task-checklist",
          icon: <Assignment />,
          roles: ["all"],
        },
        {
          subheader: "Tasks",
          label: "Task Scheduler",
          path: "/task-scheduler",
          icon: <Assignment />,
          moduleKey: "tasks",
          requireCreate: true,
        },
        {
          subheader: "Tasks",
          label: "Team Tasks",
          path: "/team-tasks",
          icon: <Assignment />,
          moduleKey: "tasks",
          requireEdit: true,
        },
        {
          subheader: "Tasks",
          label: "My Tasks",
          path: "/my-tasks",
          icon: <Assignment />,
          moduleKey: "tasks",
        },
        {
          subheader: "Tasks",
          label: "Task Compliance Admin",
          path: "/task-compliance-admin",
          icon: <TableChart />,
          roles: ["CEO", "HR Manager", "Management / HOD", "Process Coordinator"],
        },
      ],
    },
    {
      key: "crm",
      label: "CRM",
      icon: <CRMIcon />,
      items: [
        { subheader: "Get started", label: "CRM Guide", path: "/crm/guide", icon: <HelpIcon />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "CRM Dashboard", path: "/crm/dashboard", icon: <Dashboard />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Leads", path: "/crm/leads", icon: <ListAlt />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Customers", path: "/crm/customers", icon: <PeopleIcon />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Follow-ups", path: "/crm/follow-ups", icon: <Assignment />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Deals", path: "/crm/deals", icon: <TrendingUp />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Lead Scoring", path: "/crm/lead-scoring", icon: <Analytics />, roles: crmModuleRoles },
        { subheader: "Pipeline", label: "Activity Timeline", path: "/crm/timeline", icon: <Assignment />, roles: crmModuleRoles },
        { subheader: "Orders & Billing", label: "Quotations", path: "/crm/quotations", icon: <TableChart />, roles: crmModuleRoles },
        { subheader: "Orders & Billing", label: "Sales Orders", path: "/crm/sales-orders", icon: <ListAlt />, roles: crmModuleRoles },
        { subheader: "Orders & Billing", label: "Collections", path: "/crm/collections", icon: <TableChart />, roles: crmModuleRoles },
        { subheader: "Insights", label: "Customer 360", path: "/crm/customer-360", icon: <Dashboard />, roles: crmModuleRoles },
        { subheader: "Insights", label: "Documents", path: "/crm/documents", icon: <Storage />, roles: crmModuleRoles },
        { subheader: "Insights", label: "Sales Performance", path: "/crm/performance", icon: <TrendingUp />, roles: crmModuleRoles },
        { subheader: "Outreach", label: "Email Campaigns", path: "/crm/campaigns", icon: <CampaignIcon />, roles: crmModuleRoles },
        { subheader: "Flow", label: "Sales Flow", path: "/sales-flow", icon: <PurchaseIcon />, roles: ["Customer Relations Manager", "Sales Executive", "NPD", "Quality Engineer", "Director", "Production Manager", "Store Manager", "Accounts Executive", "CEO"] },
        { subheader: "Data", label: "Import CRM Data", path: "/crm-import", icon: <Input />, roles: ["CEO", "Customer Relations Manager", "Sales Executive"] },
      ],
    },
    {
      key: "ppc",
      label: "Production",
      icon: <ProductionIcon />,
      items: [
        { subheader: "Planning", label: "Production Plan", path: "/ppc/production-plan", icon: <Assignment />, roles: ppcModuleRoles },
        { subheader: "Planning", label: "Work Orders", path: "/ppc/work-orders", icon: <ListAlt />, roles: ppcModuleRoles },
        { subheader: "Planning", label: "BOM", path: "/ppc/bom", icon: <TableChart />, roles: ppcModuleRoles },
        { subheader: "Planning", label: "MRP", path: "/ppc/mrp", icon: <Analytics />, roles: ppcModuleRoles },
        { subheader: "Planning", label: "Capacity", path: "/ppc/capacity", icon: <Dashboard />, roles: ppcModuleRoles },
        { subheader: "Planning", label: "Routing", path: "/ppc/routing", icon: <Assignment />, roles: ppcModuleRoles },
        { subheader: "Shop Floor", label: "Production Tracking", path: "/ppc/tracking", icon: <TrendingUp />, roles: ppcModuleRoles },
        { subheader: "Shop Floor", label: "Quality Control", path: "/ppc/qc", icon: <SecurityIcon />, roles: ppcModuleRoles },
        { subheader: "Shop Floor", label: "Scrap Tracking", path: "/ppc/scrap", icon: <DebugIcon />, roles: ppcModuleRoles },
        { subheader: "Shop Floor", label: "Maintenance", path: "/ppc/maintenance", icon: <Settings />, roles: ppcModuleRoles },
        { subheader: "Logistics", label: "Inventory", path: "/ppc/inventory", icon: <InventoryIcon />, roles: ppcModuleRoles },
        { subheader: "Logistics", label: "Dispatch", path: "/ppc/dispatch", icon: <LocalShipping />, roles: ppcModuleRoles },
        { subheader: "Logistics", label: "Dispatch Intelligence", path: "/ppc/dispatch-intelligence", icon: <LocalShipping />, roles: ppcModuleRoles },
        { subheader: "Insights", label: "Reports", path: "/ppc/reports", icon: <Dashboard />, roles: ppcModuleRoles },
        { subheader: "Insights", label: "Production Costing", path: "/ppc/costing", icon: <CostingIcon />, roles: ppcModuleRoles },
        { subheader: "Insights", label: "Integrated Dashboard", path: "/ppc/advanced-dashboard", icon: <Dashboard />, roles: ppcModuleRoles },
        { subheader: "Lines", label: "Cable Production", path: "/cable-production", icon: <CableIcon />, roles: ["CEO", "Customer Relations Manager", "Cable Production Supervisor"] },
        { subheader: "Lines", label: "Molding Production", path: "/molding", icon: <ProductionIcon />, roles: ["CEO", "Customer Relations Manager", "Moulding Production Supervisor", "Production Manager", "Store Manager"] },
      ],
    },
    {
      key: "master-data",
      label: "Master Data",
      icon: <Storage />,
      items: [
        {
          subheader: "Administration",
          label: "Master Data Hub",
          path: "/master-data",
          icon: <GridOnOutlined />,
          roles: ["CEO", "Management / HOD", "HR Manager"],
          moduleKey: "employees",
          requireEdit: true,
        },
      ],
    },
    // System items
    ...(!config.useLocalStorage ? [
      {
        key: "system",
        label: "System",
        icon: <Settings />,
        items: [
          {
            label: "Setup Sheets",
            path: "/setup-sheets",
            icon: <TableChart />,
            roles: ["all"],
          },
          {
            label: "Troubleshoot",
            path: "/troubleshoot-sheets",
            icon: <DebugIcon />,
            roles: ["all"],
          }
        ],
      }
    ] : [
      {
        key: "system",
        label: "System",
        icon: <Settings />,
        items: [
          {
            label: "Storage Debug",
            path: "/storage-debug",
            icon: <Storage />,
            roles: ["all"],
          }
        ],
      }
    ]),
  ];

  const canOpenMenuItem = (item) => {
    if (!user) return false;
    if (permissions?.loading) return false;
    const moduleKey = item.moduleKey || getModuleKeyForPath(item.path);
    if (!moduleKey) return true;
    if (item.requireCreate) return permissions.canCreate(moduleKey);
    if (item.requireEdit) return permissions.canEdit(moduleKey);
    if (item.requireDelete) return permissions.canDelete(moduleKey);
    return permissions.canView(moduleKey);
  };

  const filteredMenuGroups = user && !permissions?.loading
    ? menuGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(canOpenMenuItem),
        }))
        .filter((group) => group.items.length > 0)
    : [];

  const finalMenuGroups = filteredMenuGroups;

  // Flatten all menu items for searching
  const allMenuItems = finalMenuGroups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      groupLabel: group.label,
    }))
  );

  // Filter search results
  const searchResults = searchQuery.trim()
    ? allMenuItems.filter((item) => {
        const query = searchQuery.toLowerCase();
        return (
          item.label.toLowerCase().includes(query) ||
          item.groupLabel.toLowerCase().includes(query) ||
          item.path.toLowerCase().includes(query)
        );
      }).slice(0, 10) // Limit to top 10 results
    : [];

  // Check if a path is active
  const isPathActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  // Check if any item in a group is active
  const isGroupActive = (group) => {
    return group.items.some(item => isPathActive(item.path));
  };

  // In the drawer, a section is open if the user toggled it, otherwise it
  // defaults to open only when it contains the active route.
  const isSectionOpen = (group) =>
    openSections[group.key] !== undefined ? openSections[group.key] : isGroupActive(group);

  // Turn a flat (already permission-filtered) item list into a render list that
  // inserts a subheader row whenever the item's `subheader` changes. Subheaders
  // attached to filtered-out items simply never appear, so empty groups are safe.
  const withSubheaders = (items) => {
    const out = [];
    let last = null;
    items.forEach((item) => {
      if (item.subheader && item.subheader !== last) {
        out.push({ type: "subheader", label: item.subheader, key: `sh-${item.subheader}` });
        last = item.subheader;
      }
      out.push({ type: "item", item });
    });
    return out;
  };

  // Highlight matched text in search results
  const highlightText = (text, query) => {
    if (!query.trim()) return text;
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <span>
        {parts.map((part, index) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={index} style={{ backgroundColor: theme.palette.warning.lighter, fontWeight: 600 }}>
              {part}
            </span>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <>
      <AppBar 
        position="sticky" 
        elevation={0}
        sx={{ 
          backgroundColor: theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
          color: theme.palette.text.primary,
          zIndex: 1300,
          top: 0,
        }}
      >
        <Toolbar sx={{ px: { xs: 2, md: 3 }, py: 1, minHeight: 64 }}>
          {/* Mobile Menu Button */}
          {isCompactNav && (
            <IconButton
              edge="start"
              color="primary"
              aria-label="menu"
              onClick={toggleDrawer}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Logo */}
          <Box
            component={Link}
            to="/"
            sx={{
              flexGrow: { xs: 1, md: 0 },
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
              mr: { md: 4 },
              transition: "opacity 0.18s ease, transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), filter 0.18s ease",
              "&:hover": {
                opacity: 1,
                transform: "scale(1.02)",
                filter: "drop-shadow(0 2px 8px rgba(13, 148, 136, 0.2))",
              },
            }}
          >
            <img
              src={process.env.PUBLIC_URL + "/reyansh-logo.png"}
              alt="Reyansh International"
              onError={(e) => {
                e.target.style.display = "none";
                if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = "block";
              }}
              style={{
                maxHeight: 36,
                width: "auto",
                objectFit: "contain",
              }}
            />
            <Typography
              variant="h6"
              sx={{
                display: "none",
                color: theme.palette.primary.main,
                fontWeight: 700,
                fontSize: { xs: "1.25rem", md: "1.375rem" },
                letterSpacing: "-0.01em",
                "&:hover": { color: theme.palette.primary.dark },
              }}
            >
              Reyansh
            </Typography>
          </Box>

          {/* Desktop Navigation */}
          {!isCompactNav && user && permissions?.loading && (
            <Box sx={{ display: "flex", alignItems: "center", flexGrow: 1, justifyContent: "center", gap: 1.5, px: 2 }}>
              {[1, 2, 3, 4].map((n) => (
                <Skeleton key={n} variant="rounded" width={96} height={36} animation="wave" />
              ))}
            </Box>
          )}
          {!isCompactNav && user && !permissions?.loading && (
            <Box sx={{ display: "flex", alignItems: "center", flexGrow: 1, justifyContent: "center" }}>
              {finalMenuGroups.map((group) => (
                <Box key={group.key} sx={{ position: "relative" }}>
                  <Tooltip title={group.label} placement="bottom">
                    <Button
                      color="inherit"
                      startIcon={group.icon}
                      endIcon={<ArrowDropDown />}
                      onClick={(e) => handleMenuOpen(e, group.key)}
                      sx={{
                        mx: 0.5,
                        py: 1.25,
                        px: 2.5,
                        borderRadius: 1.5,
                        textTransform: "none",
                        fontWeight: 500,
                        fontSize: "0.9375rem",
                        backgroundColor: isGroupActive(group) ? theme.palette.primary.main + "14" : "transparent",
                        color: isGroupActive(group) ? theme.palette.primary.main : theme.palette.text.secondary,
                        border: "none",
                        minWidth: "auto",
                        transition: "all 0.2s ease",
                        "&:hover": {
                          backgroundColor: theme.palette.primary.main + "0F",
                          color: theme.palette.primary.main,
                          textDecoration: "none",
                        },
                      }}
                    >
                      {group.label}
                    </Button>
                  </Tooltip>
                  
                  <Menu
                    anchorEl={anchorEl[group.key]}
                    open={Boolean(anchorEl[group.key])}
                    onClose={() => handleMenuClose(group.key)}
                    anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                    transformOrigin={{ vertical: "top", horizontal: "left" }}
                    PaperProps={{
                      sx: {
                        mt: 1,
                        minWidth: 220,
                        maxHeight: 400,
                        overflow: "auto",
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                        borderRadius: 2,
                        border: `1px solid ${theme.palette.divider}`,
                      }
                    }}
                  >
                    {withSubheaders(group.items).map((node) =>
                      node.type === "subheader" ? (
                        <ListSubheader
                          key={node.key}
                          disableSticky
                          sx={{
                            lineHeight: "30px",
                            mt: 0.5,
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: theme.palette.text.disabled,
                            backgroundColor: "transparent",
                          }}
                        >
                          {node.label}
                        </ListSubheader>
                      ) : (
                        <MenuItem
                          key={node.item.path}
                          component={Link}
                          to={node.item.path}
                          onClick={() => handleMenuClose(group.key)}
                          sx={{
                            py: 1.25,
                            px: 2,
                            "&:hover": { backgroundColor: theme.palette.grey[50] },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 36, color: isPathActive(node.item.path) ? theme.palette.primary.main : theme.palette.text.secondary }}>
                            {node.item.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={node.item.label}
                            sx={{
                              "& .MuiTypography-root": {
                                fontWeight: isPathActive(node.item.path) ? 600 : 400,
                                color: isPathActive(node.item.path) ? theme.palette.text.primary : theme.palette.text.secondary,
                                fontSize: "0.875rem",
                              },
                            }}
                          />
                        </MenuItem>
                      )
                    )}
                  </Menu>
                </Box>
              ))}
            </Box>
          )}

          {/* Right Side Actions */}
          <Box sx={{ display: "flex", alignItems: "center", ml: "auto", gap: 0.5 }}>
            {/* Help Button */}
            <Tooltip title="Help & Support" placement="bottom">
              <IconButton 
                color="inherit" 
                size="small"
                onClick={() => navigate('/help')}
                sx={{ 
                  color: theme.palette.text.secondary,
                  "&:hover": { 
                    backgroundColor: subtleHoverBg,
                    color: theme.palette.text.primary
                  }
                }}
              >
                <HelpIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>

            {/* Search Button */}
            <Tooltip title="Search (Ctrl+K)" placement="bottom">
              <IconButton 
                color="inherit" 
                size="small"
                onClick={handleSearchOpen}
                sx={{ 
                  color: theme.palette.text.secondary,
                  "&:hover": { 
                    backgroundColor: subtleHoverBg,
                    color: theme.palette.text.primary
                  }
                }}
              >
                <Search sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>

            {user && (
              <Tooltip title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`} placement="bottom">
                <IconButton
                  color="inherit"
                  size="small"
                  onClick={toggleMode}
                  aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
                  sx={{
                    color: theme.palette.text.secondary,
                    "&:hover": {
                      backgroundColor: subtleHoverBg,
                      color: theme.palette.text.primary,
                    },
                  }}
                >
                  {mode === "dark" ? <LightModeOutlined sx={{ fontSize: 20 }} /> : <DarkModeOutlined sx={{ fontSize: 20 }} />}
                </IconButton>
              </Tooltip>
            )}

            {/* User Profile */}
            {user ? (
              <Box>
                <Tooltip title={`${user.name} (${userRole})`} placement="bottom">
                  <IconButton onClick={handleProfileMenu} sx={{ p: 0.5, ml: 1 }}>
                    <Badge
                      overlap="circular"
                      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                      badgeContent={
                        <Box
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: theme.palette.primary.main,
                            border: `1.5px solid ${theme.palette.background.paper}`,
                          }}
                        />
                      }
                    >
                      <Avatar
                        alt={user.name}
                        src={user.imageUrl || "/static/images/avatar/2.jpg"}
                        sx={{ 
                          width: 32, 
                          height: 32,
                          border: `1px solid ${theme.palette.divider}`,
                          fontSize: "0.875rem",
                        }}
                      >
                        {user.name?.charAt(0) || "U"}
                      </Avatar>
                    </Badge>
                  </IconButton>
                </Tooltip>
                
                <Menu
                  anchorEl={profileMenuAnchor}
                  open={Boolean(profileMenuAnchor)}
                  onClose={handleProfileMenuClose}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                  PaperProps={{
                    sx: {
                      mt: 1,
                      minWidth: 250,
                      boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                        borderRadius: 2,
                        border: `1px solid ${theme.palette.divider}`,
                    }
                  }}
                >
                  <MenuItem disabled sx={{ py: 2 }}>
                    <Box sx={{ textAlign: "center", width: "100%" }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: theme.palette.text.primary }}>
                        {user.name}
                      </Typography>
                      <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 1 }}>
                        {user.email}
                      </Typography>
                      <Chip 
                        label={userRole} 
                        size="small" 
                        color="primary" 
                        variant="outlined"
                        sx={{ 
                          mt: 1,
                          fontSize: "0.75rem",
                          height: 20,
                        }}
                      />
                    </Box>
                  </MenuItem>
                  
                  <Divider />
                  
                  <MenuItem 
                    onClick={() => {
                      handleProfileMenuClose();
                      navigate('/profile');
                    }} 
                    sx={{ py: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Person sx={{ fontSize: 20 }} />
                    </ListItemIcon>
                    <ListItemText primary="Profile" />
                  </MenuItem>
                  
                  {/* Employee Dashboard / My Dashboard - Always visible for all users */}
                  <MenuItem 
                    onClick={() => {
                      handleProfileMenuClose();
                      navigate('/employee-dashboard');
                    }} 
                    sx={{ py: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <EmployeeIcon sx={{ fontSize: 20 }} />
                    </ListItemIcon>
                    <ListItemText 
                      primary={canManageEmployees ? 'Employee Dashboard' : 'My Dashboard'}
                    />
                  </MenuItem>
                  
                  <MenuItem 
                    onClick={() => {
                      handleProfileMenuClose();
                      navigate('/settings');
                    }} 
                    sx={{ py: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Settings sx={{ fontSize: 20 }} />
                    </ListItemIcon>
                    <ListItemText primary="Settings" />
                  </MenuItem>
                  
                  <Divider />
                  
                  <MenuItem onClick={handleSignOut} sx={{ py: 1.5 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <ExitToApp sx={{ fontSize: 20 }} />
                    </ListItemIcon>
                    <ListItemText primary="Sign Out" />
                  </MenuItem>
                </Menu>
              </Box>
            ) : (
              <Button 
                color="primary" 
                variant="contained" 
                component={Link} 
                to="/login"
                size="small"
                sx={{ 
                  textTransform: "none",
                  borderRadius: 1.5,
                  px: 2,
                  py: 0.75,
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                Login
              </Button>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      {isCompactNav && (
        <Drawer
          anchor="left"
          open={drawerOpen}
          onClose={toggleDrawer}
          PaperProps={{
            sx: {
              width: 280,
              backgroundColor: theme.palette.background.paper,
              borderRight: `1px solid ${theme.palette.divider}`,
            }
          }}
        >
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: theme.palette.text.primary }}>
              Menu
            </Typography>
            {user && (
              <>
                <ListItem>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      py: 2,
                      width: "100%",
                    }}
                  >
                    <Avatar
                      alt={user.name}
                      src={user.imageUrl || "/static/images/avatar/2.jpg"}
                      sx={{ width: 64, height: 64, mb: 1 }}
                    />
                    <Typography variant="subtitle1">{user.name}</Typography>
                    <Typography variant="body2" color="textSecondary">
                      {userRole}
                    </Typography>
                  </Box>
                </ListItem>
                
                {finalMenuGroups.map((group) => {
                  const sectionOpen = isSectionOpen(group);
                  const sectionActive = isGroupActive(group);
                  return (
                    <React.Fragment key={group.key}>
                      <ListItem
                        button
                        onClick={() => toggleSection(group.key)}
                        sx={{ px: 2.5, py: 1.25 }}
                      >
                        <ListItemIcon sx={{ minWidth: 36, color: sectionActive ? theme.palette.primary.main : theme.palette.text.secondary }}>
                          {group.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={group.label}
                          sx={{
                            "& .MuiTypography-root": {
                              fontWeight: 700,
                              fontSize: "0.8rem",
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              color: sectionActive ? theme.palette.text.primary : theme.palette.text.secondary,
                            },
                          }}
                        />
                        {sectionOpen ? <ExpandLess sx={{ color: theme.palette.text.disabled }} /> : <ExpandMore sx={{ color: theme.palette.text.disabled }} />}
                      </ListItem>

                      <Collapse in={sectionOpen} timeout="auto" unmountOnExit>
                        {withSubheaders(group.items).map((node) =>
                          node.type === "subheader" ? (
                            <ListItem key={node.key} sx={{ pl: 4, pr: 3, py: 0.25 }}>
                              <Typography variant="caption" sx={{ fontWeight: 700, fontSize: "0.66rem", letterSpacing: "0.07em", textTransform: "uppercase", color: theme.palette.text.disabled }}>
                                {node.label}
                              </Typography>
                            </ListItem>
                          ) : (
                            <ListItem
                              button
                              key={node.item.path}
                              component={Link}
                              to={node.item.path}
                              onClick={toggleDrawer}
                              selected={isPathActive(node.item.path)}
                              sx={{
                                pl: 5,
                                pr: 3,
                                py: 1,
                                "&.Mui-selected": {
                                  backgroundColor: theme.palette.info.lighter,
                                  "&:hover": { backgroundColor: theme.palette.info.light },
                                },
                              }}
                            >
                              <ListItemIcon sx={{ minWidth: 34, color: isPathActive(node.item.path) ? theme.palette.primary.main : theme.palette.text.secondary }}>
                                {node.item.icon}
                              </ListItemIcon>
                              <ListItemText
                                primary={node.item.label}
                                sx={{
                                  "& .MuiTypography-root": {
                                    fontWeight: isPathActive(node.item.path) ? 600 : 400,
                                    fontSize: "0.875rem",
                                  },
                                }}
                              />
                            </ListItem>
                          )
                        )}
                      </Collapse>

                      <Divider />
                    </React.Fragment>
                  );
                })}

                {/* Quick Actions */}
                <Box sx={{ px: 3, py: 2 }}>
                  <Typography variant="overline" sx={{ fontWeight: 600, mb: 2, display: "block", color: theme.palette.text.secondary, fontSize: "0.75rem" }}>
                    QUICK ACTIONS
                  </Typography>
                  
                  <Button
                    fullWidth
                    startIcon={<Search />}
                    size="small"
                    onClick={handleSearchOpen}
                    sx={{ 
                      justifyContent: "flex-start", 
                      textTransform: "none",
                      mb: 1,
                      borderRadius: 1.5,
                      color: theme.palette.text.secondary,
                      "&:hover": { backgroundColor: theme.palette.grey[100] }
                    }}
                  >
                    Search
                  </Button>
                  
                  <Button
                    fullWidth
                    startIcon={<Help />}
                    size="small"
                    sx={{ 
                      justifyContent: "flex-start", 
                      textTransform: "none",
                      mb: 1,
                      borderRadius: 1.5,
                      color: theme.palette.text.secondary,
                      "&:hover": { backgroundColor: theme.palette.grey[100] }
                    }}
                  >
                    Help
                  </Button>
                  
                  <Button
                    fullWidth
                    startIcon={<Settings />}
                    size="small"
                    sx={{ 
                      justifyContent: "flex-start", 
                      textTransform: "none",
                      borderRadius: 1.5,
                      color: theme.palette.text.secondary,
                      "&:hover": { backgroundColor: theme.palette.grey[100] }
                    }}
                  >
                    Settings
                  </Button>
                </Box>

                {/* Sign Out */}
                <Divider sx={{ my: 2 }} />
                <ListItem sx={{ px: 3 }}>
                  <Button
                    fullWidth
                    startIcon={<ExitToApp />}
                    onClick={handleSignOut}
                    size="small"
                    sx={{ 
                      justifyContent: "flex-start", 
                      textTransform: "none",
                      color: theme.palette.error.main,
                      borderRadius: 1.5,
                      "&:hover": { backgroundColor: theme.palette.error.lighter }
                    }}
                  >
                    Sign Out
                  </Button>
                </ListItem>
              </>
            )}
          </Box>
        </Drawer>
      )}

      {/* Search Dialog */}
      <Dialog
        open={searchOpen}
        onClose={handleSearchClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          }
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <TextField
              autoFocus
              fullWidth
              placeholder="Search dashboards, management, workflows..."
              variant="outlined"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ color: theme.palette.text.secondary }} />
                  </InputAdornment>
                ),
                sx: {
                  fontSize: "0.95rem",
                  "& .MuiOutlinedInput-notchedOutline": {
                    border: "none",
                  },
                },
              }}
              sx={{
                "& .MuiInputBase-root": {
                  backgroundColor: theme.palette.grey[50],
                  borderRadius: 2,
                },
              }}
            />
          </Box>

          {/* Search Results */}
          <Box sx={{ maxHeight: 400, overflow: "auto" }}>
            {searchQuery.trim() === "" ? (
              <Box sx={{ p: 6, textAlign: "center" }}>
                <Search sx={{ fontSize: 48, color: theme.palette.grey[400], mb: 2 }} />
                <Typography variant="body2" color="text.secondary">
                  Start typing to search for dashboards, management tools, workflows, and more...
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  Tip: Press <Chip label="Ctrl+K" size="small" sx={{ mx: 0.5 }} /> to open search anytime
                </Typography>
              </Box>
            ) : searchResults.length === 0 ? (
              <Box sx={{ p: 6, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  No results found for "{searchQuery}"
                </Typography>
              </Box>
            ) : (
              <List sx={{ p: 1 }}>
                {searchResults.map((item, index) => (
                  <ListItem
                    key={`${item.path}-${index}`}
                    button
                    onClick={() => handleSearchNavigate(item.path)}
                    sx={{
                      borderRadius: 2,
                      mb: 0.5,
                      "&:hover": {
                        backgroundColor: theme.palette.grey[100],
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40, color: theme.palette.primary.main }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {highlightText(item.label, searchQuery)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                            {item.groupLabel} • {item.path}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          {/* Footer */}
          {searchResults.length > 0 && (
            <Box
              sx={{
                p: 1.5,
                borderTop: `1px solid ${theme.palette.divider}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: theme.palette.grey[50],
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Press <Chip label="Enter" size="small" sx={{ height: 18, fontSize: "0.7rem", mx: 0.5 }} /> to navigate
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Header;
