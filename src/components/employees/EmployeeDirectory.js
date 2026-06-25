import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  InputAdornment,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  IconButton,
  Menu,
  Checkbox,
  ListItemIcon,
  ListItemText,
  Avatar,
  Chip,
  Typography,
  Tooltip,
  Skeleton,
  Divider,
  Slide,
  useTheme,
  useMediaQuery,
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import ClearIcon from "@mui/icons-material/Clear";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import SwapHorizOutlinedIcon from "@mui/icons-material/SwapHorizOutlined";
import SupervisorAccountOutlinedIcon from "@mui/icons-material/SupervisorAccountOutlined";
import PowerSettingsNewOutlinedIcon from "@mui/icons-material/PowerSettingsNew";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import UnarchiveOutlinedIcon from "@mui/icons-material/UnarchiveOutlined";

const COLS_STORAGE_KEY = "reyansh.emp.dir.cols";

// Optional columns the user can toggle. Core columns are always visible.
const OPTIONAL_COLUMNS = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "employment_type", label: "Employment type" },
];

const DEFAULT_OPTIONAL = { email: false, phone: false, employment_type: false };

const SAVED_VIEWS = [
  { id: "all", label: "All employees" },
  { id: "active", label: "Active only" },
  { id: "inactive", label: "Inactive" },
  { id: "noaccess", label: "No access" },
  { id: "archived", label: "Archived" },
];

// ---------- helpers ----------

function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function isActiveEmp(emp) {
  if (!emp) return false;
  if (typeof emp.is_active === "boolean") return emp.is_active;
  return safeStr(emp.status).toLowerCase() === "active";
}

function initialsOf(emp) {
  const name = safeStr(emp && emp.full_name).trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const email = safeStr(emp && emp.email).trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

// Deterministic avatar color from a string so each employee keeps a stable hue.
function avatarColor(theme, seed) {
  const palette = [
    theme.palette.primary.main,
    theme.palette.secondary.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.info.main,
    theme.palette.error.main,
  ];
  const s = safeStr(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function formatJoinDate(value) {
  const raw = safeStr(value).trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // joining_date is free text; show as-is if unparseable
  try {
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (e) {
    return raw;
  }
}

function joinDateSortValue(value) {
  const d = new Date(safeStr(value));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function loadColumnPrefs() {
  try {
    const raw = window.localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONAL };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OPTIONAL, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch (e) {
    return { ...DEFAULT_OPTIONAL };
  }
}

// ---------- subcomponents ----------

function EmployeeAvatar({ emp, theme }) {
  const color = avatarColor(theme, (emp && emp.id) || (emp && emp.email) || (emp && emp.full_name));
  const photo = safeStr(emp && emp.profile_photo).trim();
  return (
    <Avatar
      src={photo || undefined}
      sx={{
        width: 34,
        height: 34,
        fontSize: "0.8125rem",
        fontWeight: 700,
        bgcolor: alpha(color, 0.16),
        color,
      }}
    >
      {initialsOf(emp)}
    </Avatar>
  );
}

function StatusChip({ active }) {
  return (
    <Chip
      size="small"
      label={active ? "Active" : "Inactive"}
      color={active ? "success" : "default"}
      variant={active ? "filled" : "outlined"}
      sx={{
        fontWeight: 600,
        height: 22,
        ...(active
          ? {}
          : {
              color: "text.secondary",
              borderColor: "divider",
            }),
      }}
    />
  );
}

// ---------- main component ----------

export default function EmployeeDirectory({
  employees = [],
  loading = false,
  onOpenEmployee = () => {},
  onAddEmployee = () => {},
  onBulkSetStatus = () => {},
  onBulkAssignAccess = () => {},
  onExport = () => {},
  onImport = () => {},
  actions = {},
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [rowMenu, setRowMenu] = useState({ anchor: null, emp: null });
  const closeRowMenu = useCallback(() => setRowMenu({ anchor: null, emp: null }), []);
  // Run a row action then close the menu.
  const runAction = useCallback((fn) => () => { const emp = rowMenu.emp; closeRowMenu(); fn?.(emp); }, [rowMenu.emp, closeRowMenu]);

  const rows = Array.isArray(employees) ? employees : [];

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [status, setStatus] = useState("all"); // all | active | inactive
  const [activeView, setActiveView] = useState("all");
  const [orderBy, setOrderBy] = useState("full_name");
  const [order, setOrder] = useState("asc");
  const [selected, setSelected] = useState(() => new Set());

  const [optionalCols, setOptionalCols] = useState(loadColumnPrefs);

  const [viewsAnchor, setViewsAnchor] = useState(null);
  const [colsAnchor, setColsAnchor] = useState(null);

  // Persist column choices.
  useEffect(() => {
    try {
      window.localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(optionalCols));
    } catch (e) {
      /* ignore quota / private mode */
    }
  }, [optionalCols]);

  // Distinct departments for the filter Select.
  const departments = useMemo(() => {
    const set = new Set();
    rows.forEach((e) => {
      const d = safeStr(e && e.department).trim();
      if (d) set.add(d);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Apply filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((e) => {
      if (!e) return false;

      // archive filter: hide archived everywhere except the "Archived" view
      const archived = !!e.archived_at;
      if (activeView === "archived") { if (!archived) return false; }
      else if (archived) return false;

      // status filter
      const active = isActiveEmp(e);
      if (status === "active" && !active) return false;
      if (status === "inactive" && active) return false;

      // saved-view: "no access"
      if (activeView === "noaccess" && Number(e.moduleCount || 0) !== 0) return false;

      // department filter
      if (department !== "all" && safeStr(e.department) !== department) return false;

      // global search
      if (q) {
        const haystack = [
          e.full_name,
          e.email,
          e.employee_code,
          e.department,
          e.designation,
        ]
          .map(safeStr)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, status, department, activeView]);

  // Sort.
  const sorted = useMemo(() => {
    const arr = filtered.slice();
    const dir = order === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av;
      let bv;
      if (orderBy === "join_date") {
        av = joinDateSortValue(a.joining_date);
        bv = joinDateSortValue(b.joining_date);
        return (av - bv) * dir;
      }
      if (orderBy === "department") {
        av = safeStr(a.department).toLowerCase();
        bv = safeStr(b.department).toLowerCase();
      } else {
        av = safeStr(a.full_name || a.email).toLowerCase();
        bv = safeStr(b.full_name || b.email).toLowerCase();
      }
      return av.localeCompare(bv) * dir;
    });
    return arr;
  }, [filtered, orderBy, order]);

  const filtersDirty =
    search.trim() !== "" || department !== "all" || status !== "all" || activeView !== "all";

  // Selection helpers (operate over the currently-visible/sorted rows).
  const visibleIds = useMemo(() => sorted.map((e) => e.id), [sorted]);
  const selectedVisibleIds = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected]
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
  const someVisibleSelected =
    selectedVisibleIds.length > 0 && selectedVisibleIds.length < visibleIds.length;

  const handleSort = useCallback(
    (col) => {
      setOrderBy((prevCol) => {
        if (prevCol === col) {
          setOrder((o) => (o === "asc" ? "desc" : "asc"));
          return prevCol;
        }
        setOrder("asc");
        return col;
      });
    },
    []
  );

  const toggleRow = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allVisibleSelected, visibleIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setDepartment("all");
    setStatus("all");
    setActiveView("all");
  }, []);

  const applyView = useCallback((viewId) => {
    setActiveView(viewId);
    setViewsAnchor(null);
    if (viewId === "all") {
      setStatus("all");
    } else if (viewId === "active") {
      setStatus("active");
    } else if (viewId === "inactive") {
      setStatus("inactive");
    } else if (viewId === "noaccess") {
      setStatus("all");
    }
  }, []);

  const selectedRows = useMemo(
    () => rows.filter((e) => selected.has(e.id)),
    [rows, selected]
  );
  const selectedIdsArr = useMemo(() => Array.from(selected), [selected]);

  // ---------- toolbar ----------
  const toolbar = (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1.5}
      alignItems={{ xs: "stretch", md: "center" }}
      sx={{ p: 2, pb: 1.5 }}
    >
      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, ID, department…"
        size="small"
        fullWidth
        sx={{ maxWidth: { md: 360 } }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
            </InputAdornment>
          ),
          endAdornment: search ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setSearch("")} edge="end">
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="emp-dept-label">Department</InputLabel>
        <Select
          labelId="emp-dept-label"
          label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <MenuItem value="all">All departments</MenuItem>
          {departments.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 130 }}>
        <InputLabel id="emp-status-label">Status</InputLabel>
        <Select
          labelId="emp-status-label"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setActiveView("all");
          }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="inactive">Inactive</MenuItem>
        </Select>
      </FormControl>

      <Box sx={{ flexGrow: 1 }} />

      <Stack direction="row" spacing={1} alignItems="center">
        <Tooltip title="Saved views">
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            startIcon={<BookmarkBorderOutlinedIcon />}
            onClick={(e) => setViewsAnchor(e.currentTarget)}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Views
          </Button>
        </Tooltip>
        <Menu
          anchorEl={viewsAnchor}
          open={Boolean(viewsAnchor)}
          onClose={() => setViewsAnchor(null)}
        >
          {SAVED_VIEWS.map((v) => (
            <MenuItem
              key={v.id}
              selected={activeView === v.id}
              onClick={() => applyView(v.id)}
            >
              {v.label}
            </MenuItem>
          ))}
        </Menu>

        <Tooltip title="Columns">
          <IconButton
            size="small"
            onClick={(e) => setColsAnchor(e.currentTarget)}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}
          >
            <ViewColumnOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={colsAnchor}
          open={Boolean(colsAnchor)}
          onClose={() => setColsAnchor(null)}
        >
          <Typography
            variant="caption"
            sx={{ px: 2, py: 0.5, display: "block", color: "text.secondary" }}
          >
            Optional columns
          </Typography>
          {OPTIONAL_COLUMNS.map((c) => (
            <MenuItem
              key={c.id}
              onClick={() =>
                setOptionalCols((prev) => ({ ...prev, [c.id]: !prev[c.id] }))
              }
              dense
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Checkbox
                  edge="start"
                  size="small"
                  checked={Boolean(optionalCols[c.id])}
                  tabIndex={-1}
                  disableRipple
                />
              </ListItemIcon>
              <ListItemText primary={c.label} />
            </MenuItem>
          ))}
        </Menu>

        <Button
          variant="outlined"
          size="small"
          color="inherit"
          startIcon={<UploadFileOutlinedIcon />}
          onClick={onImport}
          sx={{ borderColor: "divider", color: "text.secondary" }}
        >
          Import
        </Button>

        <Button
          variant="outlined"
          size="small"
          color="inherit"
          startIcon={<FileDownloadOutlinedIcon />}
          onClick={() => onExport(sorted)}
          sx={{ borderColor: "divider", color: "text.secondary" }}
        >
          Export
        </Button>

        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={onAddEmployee}
        >
          Add Employee
        </Button>
      </Stack>
    </Stack>
  );

  // ---------- column definitions for table head ----------
  const headCellSx = {
    bgcolor: "background.paper",
    color: "text.secondary",
    fontWeight: 700,
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: 2,
    borderColor: "divider",
    whiteSpace: "nowrap",
  };

  // ---------- table (desktop) ----------
  const renderTable = () => (
    <TableContainer sx={{ flex: 1, overflow: "auto" }}>
      <Table stickyHeader size="small" sx={{ minWidth: 880 }}>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" sx={{ ...headCellSx }}>
              <Checkbox
                size="small"
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected}
                onChange={toggleSelectAll}
                disabled={visibleIds.length === 0}
              />
            </TableCell>
            <TableCell sx={headCellSx}>Employee ID</TableCell>
            <TableCell sx={headCellSx} sortDirection={orderBy === "full_name" ? order : false}>
              <TableSortLabel
                active={orderBy === "full_name"}
                direction={orderBy === "full_name" ? order : "asc"}
                onClick={() => handleSort("full_name")}
              >
                Name
              </TableSortLabel>
            </TableCell>
            <TableCell sx={headCellSx} sortDirection={orderBy === "department" ? order : false}>
              <TableSortLabel
                active={orderBy === "department"}
                direction={orderBy === "department" ? order : "asc"}
                onClick={() => handleSort("department")}
              >
                Department
              </TableSortLabel>
            </TableCell>
            <TableCell sx={headCellSx}>Designation</TableCell>
            {optionalCols.email && <TableCell sx={headCellSx}>Email</TableCell>}
            {optionalCols.phone && <TableCell sx={headCellSx}>Phone</TableCell>}
            {optionalCols.employment_type && (
              <TableCell sx={headCellSx}>Employment</TableCell>
            )}
            <TableCell sx={headCellSx}>Reporting Manager</TableCell>
            <TableCell sx={headCellSx}>Status</TableCell>
            <TableCell sx={headCellSx} sortDirection={orderBy === "join_date" ? order : false}>
              <TableSortLabel
                active={orderBy === "join_date"}
                direction={orderBy === "join_date" ? order : "asc"}
                onClick={() => handleSort("join_date")}
              >
                Join date
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ ...headCellSx, width: 48 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {loading
            ? renderSkeletonRows()
            : sorted.map((emp) => {
                const checked = selected.has(emp.id);
                return (
                  <TableRow
                    key={emp.id}
                    hover
                    selected={checked}
                    onClick={() => onOpenEmployee(emp)}
                    sx={{
                      cursor: "pointer",
                      height: 52,
                      "& .row-open-action": { opacity: 0, transition: "opacity .15s" },
                      "&:hover .row-open-action": { opacity: 1 },
                    }}
                  >
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        size="small"
                        checked={checked}
                        onChange={() => toggleRow(emp.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: "monospace", color: "text.secondary" }}
                      >
                        {safeStr(emp.employee_code) || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <EmployeeAvatar emp={emp} theme={theme} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                            {safeStr(emp.full_name) || "Unnamed"}
                          </Typography>
                          <Typography
                            variant="caption"
                            noWrap
                            sx={{ color: "text.secondary", display: "block" }}
                          >
                            {safeStr(emp.email)}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {safeStr(emp.department) || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {safeStr(emp.designation) || "—"}
                      </Typography>
                    </TableCell>
                    {optionalCols.email && (
                      <TableCell>
                        <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                          {safeStr(emp.email) || "—"}
                        </Typography>
                      </TableCell>
                    )}
                    {optionalCols.phone && (
                      <TableCell>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          {safeStr(emp.phone) || "—"}
                        </Typography>
                      </TableCell>
                    )}
                    {optionalCols.employment_type && (
                      <TableCell>
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                          {safeStr(emp.employment_type) || "—"}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {safeStr(emp.reporting_manager) || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip active={isActiveEmp(emp)} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ color: "text.secondary" }} noWrap>
                        {formatJoinDate(emp.joining_date)}
                      </Typography>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} align="right">
                      <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                        <Tooltip title="Open">
                          <IconButton
                            size="small"
                            className="row-open-action"
                            onClick={() => onOpenEmployee(emp)}
                          >
                            <LaunchIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Actions">
                          <IconButton size="small" onClick={(e) => setRowMenu({ anchor: e.currentTarget, emp })}>
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
        </TableBody>
      </Table>
    </TableContainer>
  );

  const optionalColCount =
    (optionalCols.email ? 1 : 0) +
    (optionalCols.phone ? 1 : 0) +
    (optionalCols.employment_type ? 1 : 0);
  const totalColSpan = 8 + optionalColCount;

  function renderSkeletonRows() {
    return Array.from({ length: 8 }).map((_, i) => (
      <TableRow key={`sk-${i}`} sx={{ height: 52 }}>
        <TableCell padding="checkbox">
          <Skeleton variant="rounded" width={18} height={18} />
        </TableCell>
        <TableCell colSpan={totalColSpan - 1}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Skeleton variant="circular" width={34} height={34} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="30%" />
              <Skeleton variant="text" width="20%" />
            </Box>
          </Stack>
        </TableCell>
      </TableRow>
    ));
  }

  // ---------- mobile card list ----------
  const renderMobileList = () => {
    if (loading) {
      return (
        <Stack spacing={1.5} sx={{ p: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Paper key={`mc-${i}`} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Skeleton variant="circular" width={40} height={40} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="40%" />
                </Box>
              </Stack>
            </Paper>
          ))}
        </Stack>
      );
    }
    if (sorted.length === 0) return renderEmpty();
    return (
      <Stack spacing={1.25} sx={{ p: 2 }}>
        {sorted.map((emp) => {
          const checked = selected.has(emp.id);
          return (
            <Paper
              key={emp.id}
              variant="outlined"
              onClick={() => onOpenEmployee(emp)}
              sx={{
                p: 1.75,
                cursor: "pointer",
                borderColor: checked ? "primary.main" : "divider",
                bgcolor: checked ? alpha(theme.palette.primary.main, 0.04) : "background.paper",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Checkbox
                  size="small"
                  checked={checked}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleRow(emp.id)}
                  sx={{ p: 0.5, mt: -0.25 }}
                />
                <EmployeeAvatar emp={emp} theme={theme} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    spacing={1}
                  >
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {safeStr(emp.full_name) || "Unnamed"}
                    </Typography>
                    <StatusChip active={isActiveEmp(emp)} />
                  </Stack>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
                    {safeStr(emp.email)}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                    {emp.employee_code && (
                      <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
                        {emp.employee_code}
                      </Typography>
                    )}
                    {emp.department && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {"•"} {emp.department}
                      </Typography>
                    )}
                    {emp.designation && (
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {"•"} {emp.designation}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    );
  };

  // ---------- empty state ----------
  function renderEmpty() {
    return (
      <Box
        sx={{
          py: 8,
          px: 3,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <GroupOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
        <Typography variant="h6" sx={{ color: "text.primary" }}>
          {filtersDirty ? "No employees match" : "No employees yet"}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 360 }}>
          {filtersDirty
            ? "Try adjusting your search or filters to see more results."
            : "Add your first employee to get started with the directory."}
        </Typography>
        {filtersDirty ? (
          <Button variant="outlined" size="small" startIcon={<ClearIcon />} onClick={clearFilters}>
            Clear filters
          </Button>
        ) : (
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onAddEmployee}>
            Add Employee
          </Button>
        )}
      </Box>
    );
  }

  const showEmpty = !loading && sorted.length === 0;
  const selectedCount = selectedIdsArr.length;

  return (
    <Paper
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        bgcolor: "background.paper",
      }}
    >
      {toolbar}
      <Divider />

      {/* count line */}
      {!loading && (
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {sorted.length} {sorted.length === 1 ? "employee" : "employees"}
            {filtersDirty ? ` of ${rows.length}` : ""}
          </Typography>
        </Box>
      )}

      {isMobile ? (
        renderMobileList()
      ) : showEmpty ? (
        renderEmpty()
      ) : (
        renderTable()
      )}

      {/* bulk action bar */}
      <Slide direction="up" in={selectedCount > 0} mountOnEnter unmountOnExit>
        <Box
          sx={{
            position: "sticky",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            p: 1.5,
          }}
        >
          <Paper
            elevation={6}
            sx={{
              mx: "auto",
              maxWidth: 760,
              px: 2,
              py: 1,
              borderRadius: 3,
              bgcolor: "secondary.main",
              color: "secondary.contrastText",
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, mr: 1 }}>
              {selectedCount} selected
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              size="small"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={() => onBulkSetStatus(selectedIdsArr, true)}
              sx={{ color: "inherit" }}
            >
              Set Active
            </Button>
            <Button
              size="small"
              startIcon={<HighlightOffIcon />}
              onClick={() => onBulkSetStatus(selectedIdsArr, false)}
              sx={{ color: "inherit" }}
            >
              Set Inactive
            </Button>
            <Button
              size="small"
              startIcon={<SwapHorizOutlinedIcon />}
              onClick={() => actions.onBulkTransfer?.(selectedIdsArr)}
              sx={{ color: "inherit" }}
            >
              Transfer dept
            </Button>
            <Button
              size="small"
              startIcon={<SupervisorAccountOutlinedIcon />}
              onClick={() => actions.onBulkAssignManager?.(selectedIdsArr)}
              sx={{ color: "inherit" }}
            >
              Assign manager
            </Button>
            <Button
              size="small"
              startIcon={<VpnKeyOutlinedIcon />}
              onClick={() => onBulkAssignAccess(selectedIdsArr)}
              sx={{ color: "inherit" }}
            >
              Assign access
            </Button>
            <Button
              size="small"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={() => onExport(selectedRows)}
              sx={{ color: "inherit" }}
            >
              Export
            </Button>
            <Button
              size="small"
              startIcon={<ArchiveOutlinedIcon />}
              onClick={() => (activeView === "archived" ? actions.onBulkUnarchive?.(selectedIdsArr) : actions.onBulkArchive?.(selectedIdsArr))}
              sx={{ color: "inherit" }}
            >
              {activeView === "archived" ? "Unarchive" : "Archive"}
            </Button>
            <Button
              size="small"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => actions.onBulkDelete?.(selectedIdsArr)}
              sx={{ color: "#ffd5d5" }}
            >
              Delete
            </Button>
            <Divider orientation="vertical" flexItem sx={{ borderColor: alpha("#fff", 0.2), mx: 0.5 }} />
            <Button
              size="small"
              startIcon={<ClearIcon />}
              onClick={clearSelection}
              sx={{ color: "inherit" }}
            >
              Clear
            </Button>
          </Paper>
        </Box>
      </Slide>

      {/* Per-row actions menu */}
      <Menu
        anchorEl={rowMenu.anchor}
        open={Boolean(rowMenu.anchor)}
        onClose={closeRowMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={runAction(onOpenEmployee)}>
          <ListItemIcon><VisibilityOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        <MenuItem onClick={runAction(actions.onEdit)}>
          <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={runAction(actions.onDuplicate)}>
          <ListItemIcon><ContentCopyOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={runAction(actions.onTransfer)}>
          <ListItemIcon><SwapHorizOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Transfer department</ListItemText>
        </MenuItem>
        <MenuItem onClick={runAction(actions.onChangeManager)}>
          <ListItemIcon><SupervisorAccountOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Change reporting manager</ListItemText>
        </MenuItem>
        <MenuItem onClick={runAction(actions.onToggleActive)}>
          <ListItemIcon><PowerSettingsNewOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{rowMenu.emp?.is_active === false ? "Activate" : "Deactivate"}</ListItemText>
        </MenuItem>
        {rowMenu.emp?.archived_at ? (
          <MenuItem onClick={runAction(actions.onUnarchive)}>
            <ListItemIcon><UnarchiveOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Unarchive</ListItemText>
          </MenuItem>
        ) : (
          <MenuItem onClick={runAction(actions.onArchive)}>
            <ListItemIcon><ArchiveOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Archive</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={runAction(actions.onDelete)} sx={{ color: "error.main" }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </Paper>
  );
}
