// Collapsible left-sidebar navigation for the ERP shell.
// - Expanded: module search, ⭐ favorites, 🕐 recents, accordion groups.
// - Collapsed (72px): icon rail; hover opens a flyout submenu (no truncation).
// - Mobile (<lg): rendered inside a temporary slide-out Drawer.
// Permission filtering mirrors the old Header (path -> module key via
// config/moduleAccess, checked against PermissionContext). Config lives in
// navConfig.js so adding a module never touches this file.
import React, { useState, useMemo, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Drawer,
  Typography,
  Tooltip,
  IconButton,
  InputBase,
  Collapse,
  Popover,
  useTheme,
  useMediaQuery,
  alpha,
} from "@mui/material";
import {
  Search as SearchIcon,
  StarRounded,
  StarBorderRounded,
  ExpandMore,
  ExpandLess,
  ChevronLeft,
  ChevronRight,
  AccessTimeRounded,
  Close as CloseIcon,
} from "@mui/icons-material";
import { usePermissions } from "../../context/PermissionContext";
import { useAuth } from "../../context/AuthContext";
import { getModuleKeyForPath } from "../../config/moduleAccess";
import { NAV_GROUPS, ALL_NAV_ITEMS, basePath } from "./navConfig";

export const SIDEBAR_WIDTH = 264;
export const SIDEBAR_COLLAPSED = 76;

// ---- helpers -------------------------------------------------------------
function isItemActive(item, loc) {
  const ip = basePath(item.path);
  const lp = basePath(loc.pathname);
  if (!(lp === ip || lp.startsWith(ip + "/"))) return false;
  const q = item.path.split("?")[1];
  if (q) {
    const want = new URLSearchParams(q);
    const cur = new URLSearchParams(loc.search);
    for (const [k, v] of want) if (cur.get(k) !== v) return false;
  }
  return true;
}

function useCanOpen() {
  const { user } = useAuth();
  const permissions = usePermissions();
  return useMemo(() => {
    return (item) => {
      if (!user || permissions?.loading) return false;
      const moduleKey = item.moduleKey || getModuleKeyForPath(basePath(item.path));
      if (!moduleKey) return true;
      if (item.requireCreate) return permissions.canCreate(moduleKey);
      if (item.requireEdit) return permissions.canEdit(moduleKey);
      if (item.requireDelete) return permissions.canDelete(moduleKey);
      return permissions.canView(moduleKey);
    };
  }, [user, permissions]);
}

// ---- a single item row (expanded / flyout / mobile) ----------------------
function ItemRow({ item, active, onNavigate, isFavorite, toggleFavorite, dense }) {
  const theme = useTheme();
  return (
    <Box
      onClick={() => onNavigate(item)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        pl: dense ? 1.25 : 2.25,
        pr: 1,
        py: 0.9,
        mx: 1,
        borderRadius: 1.5,
        cursor: "pointer",
        position: "relative",
        color: active ? theme.palette.primary.main : theme.palette.text.secondary,
        backgroundColor: active ? alpha(theme.palette.primary.main, 0.1) : "transparent",
        fontWeight: active ? 600 : 500,
        "&:hover": {
          backgroundColor: active
            ? alpha(theme.palette.primary.main, 0.14)
            : alpha(theme.palette.text.primary, 0.05),
          color: active ? theme.palette.primary.main : theme.palette.text.primary,
          "& .fav-btn": { opacity: 1 },
        },
        "&:before": active
          ? {
              content: '""',
              position: "absolute",
              left: -4,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: 3,
              backgroundColor: theme.palette.primary.main,
            }
          : undefined,
      }}
    >
      <Box sx={{ display: "flex", color: "inherit", "& svg": { fontSize: 20 } }}>{item.icon}</Box>
      <Typography
        variant="body2"
        noWrap
        sx={{ flex: 1, fontWeight: "inherit", color: "inherit", fontSize: "0.84rem" }}
      >
        {item.label}
      </Typography>
      <IconButton
        className="fav-btn"
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(item.path);
        }}
        sx={{
          p: 0.25,
          opacity: isFavorite(item.path) ? 1 : 0,
          color: isFavorite(item.path) ? theme.palette.warning.main : theme.palette.text.disabled,
          transition: "opacity 0.15s",
        }}
      >
        {isFavorite(item.path) ? (
          <StarRounded sx={{ fontSize: 16 }} />
        ) : (
          <StarBorderRounded sx={{ fontSize: 16 }} />
        )}
      </IconButton>
    </Box>
  );
}

// ---- section label -------------------------------------------------------
function SectionLabel({ children }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        px: 2.5,
        mt: 1.5,
        mb: 0.5,
        fontSize: "0.66rem",
        fontWeight: 700,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: theme.palette.text.disabled,
      }}
    >
      {children}
    </Typography>
  );
}

// ---- the inner content (shared by permanent + drawer) --------------------
function SidebarContent({ collapsed, favHelpers, onNavigate, onClose, isMobile }) {
  const theme = useTheme();
  const location = useLocation();
  const canOpen = useCanOpen();
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState({});
  const [flyover, setFlyover] = useState({ anchor: null, group: null });
  const { isFavorite, toggleFavorite, favorites, recents } = favHelpers;

  // Permission-filtered groups (drop empty groups).
  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(canOpen) })).filter(
        (g) => g.items.length > 0
      ),
    [canOpen]
  );

  // Auto-open the group that contains the active route.
  const activeGroupKey = useMemo(() => {
    for (const g of groups) if (g.items.some((it) => isItemActive(it, location))) return g.key;
    return null;
  }, [groups, location]);

  useEffect(() => {
    if (activeGroupKey) setOpenGroups((p) => ({ ...p, [activeGroupKey]: true }));
  }, [activeGroupKey]);

  const favItems = useMemo(
    () => favorites.map((p) => ALL_NAV_ITEMS.find((i) => i.path === p)).filter(Boolean).filter(canOpen),
    [favorites, canOpen]
  );
  const recentItems = useMemo(
    () =>
      recents
        .map((r) => ALL_NAV_ITEMS.find((i) => i.path === r.path))
        .filter(Boolean)
        .filter(canOpen)
        .filter((i) => !favorites.includes(i.path)),
    [recents, canOpen, favorites]
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL_NAV_ITEMS.filter(canOpen).filter(
      (i) => i.label.toLowerCase().includes(q) || i.groupLabel.toLowerCase().includes(q)
    );
  }, [query, canOpen]);

  const fav = { isFavorite, toggleFavorite };

  // ---------------- COLLAPSED ICON RAIL ----------------
  if (collapsed && !isMobile) {
    return (
      <Box sx={{ py: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
        {groups.map((g) => {
          const groupActive = g.key === activeGroupKey;
          return (
            <React.Fragment key={g.key}>
              <Tooltip title={g.label} placement="right">
                <IconButton
                  onClick={(e) => setFlyover({ anchor: e.currentTarget, group: g })}
                  onMouseEnter={(e) => setFlyover({ anchor: e.currentTarget, group: g })}
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    color: groupActive ? theme.palette.primary.main : theme.palette.text.secondary,
                    backgroundColor: groupActive
                      ? alpha(theme.palette.primary.main, 0.1)
                      : "transparent",
                    "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
                  }}
                >
                  {g.icon}
                </IconButton>
              </Tooltip>
            </React.Fragment>
          );
        })}
        <Popover
          open={Boolean(flyover.anchor)}
          anchorEl={flyover.anchor}
          onClose={() => setFlyover({ anchor: null, group: null })}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          PaperProps={{
            onMouseLeave: () => setFlyover({ anchor: null, group: null }),
            sx: {
              ml: 0.5,
              minWidth: 230,
              py: 1,
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: "0 12px 28px -8px rgba(0,0,0,0.18)",
            },
          }}
        >
          {flyover.group && (
            <>
              <SectionLabel>{flyover.group.label}</SectionLabel>
              {flyover.group.items.map((it) => (
                <ItemRow
                  key={it.path}
                  item={it}
                  active={isItemActive(it, location)}
                  onNavigate={(i) => {
                    setFlyover({ anchor: null, group: null });
                    onNavigate(i);
                  }}
                  {...fav}
                />
              ))}
            </>
          )}
        </Popover>
      </Box>
    );
  }

  // ---------------- EXPANDED / MOBILE ----------------
  return (
    <Box sx={{ py: 1, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Mobile close header */}
      {isMobile && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", px: 1, mb: 0.5 }}>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Module search */}
      <Box sx={{ px: 1.5, mb: 0.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.25,
            py: 0.75,
            borderRadius: 2,
            backgroundColor: alpha(theme.palette.text.primary, 0.05),
            border: `1px solid ${theme.palette.divider}`,
          }}
        >
          <SearchIcon sx={{ fontSize: 18, color: theme.palette.text.disabled }} />
          <InputBase
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find module…"
            sx={{ flex: 1, fontSize: "0.84rem" }}
          />
          {query && (
            <IconButton size="small" sx={{ p: 0.25 }} onClick={() => setQuery("")}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", pb: 2 }}>
        {/* Search results take over the list */}
        {searchResults ? (
          <>
            <SectionLabel>{searchResults.length} result{searchResults.length === 1 ? "" : "s"}</SectionLabel>
            {searchResults.length === 0 && (
              <Typography variant="caption" sx={{ px: 2.5, color: "text.disabled" }}>
                No modules match “{query}”.
              </Typography>
            )}
            {searchResults.map((it) => (
              <ItemRow
                key={it.path}
                item={it}
                active={isItemActive(it, location)}
                onNavigate={onNavigate}
                {...fav}
              />
            ))}
          </>
        ) : (
          <>
            {/* Favorites */}
            {favItems.length > 0 && (
              <>
                <SectionLabel>★ Favorites</SectionLabel>
                {favItems.map((it) => (
                  <ItemRow key={it.path} item={it} active={isItemActive(it, location)} onNavigate={onNavigate} {...fav} />
                ))}
              </>
            )}

            {/* Recents */}
            {recentItems.length > 0 && (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 2.5, mt: 1.5, mb: 0.5 }}>
                  <AccessTimeRounded sx={{ fontSize: 13, color: "text.disabled" }} />
                  <Typography sx={{ fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "text.disabled" }}>
                    Recent
                  </Typography>
                </Box>
                {recentItems.slice(0, 4).map((it) => (
                  <ItemRow key={it.path} item={it} active={isItemActive(it, location)} onNavigate={onNavigate} {...fav} />
                ))}
              </>
            )}

            {(favItems.length > 0 || recentItems.length > 0) && (
              <Box sx={{ borderTop: `1px solid ${theme.palette.divider}`, mx: 2, my: 1 }} />
            )}

            {/* Accordion groups */}
            {groups.map((g) => {
              const open = openGroups[g.key] ?? false;
              const groupActive = g.key === activeGroupKey;
              return (
                <Box key={g.key} sx={{ mb: 0.25 }}>
                  <Box
                    onClick={() => setOpenGroups((p) => ({ ...p, [g.key]: !open }))}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.25,
                      px: 2.25,
                      py: 0.9,
                      mx: 1,
                      borderRadius: 1.5,
                      cursor: "pointer",
                      color: groupActive ? theme.palette.primary.main : theme.palette.text.primary,
                      "&:hover": { backgroundColor: alpha(theme.palette.text.primary, 0.05) },
                    }}
                  >
                    <Box sx={{ display: "flex", color: "inherit", "& svg": { fontSize: 20 } }}>{g.icon}</Box>
                    <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, fontSize: "0.84rem", color: "inherit" }}>
                      {g.label}
                    </Typography>
                    {open ? (
                      <ExpandLess sx={{ fontSize: 18, color: "text.disabled" }} />
                    ) : (
                      <ExpandMore sx={{ fontSize: 18, color: "text.disabled" }} />
                    )}
                  </Box>
                  <Collapse in={open} unmountOnExit>
                    <Box sx={{ pb: 0.5 }}>
                      {g.items.map((it) => (
                        <ItemRow
                          key={it.path}
                          item={it}
                          active={isItemActive(it, location)}
                          onNavigate={onNavigate}
                          dense
                          {...fav}
                        />
                      ))}
                    </Box>
                  </Collapse>
                </Box>
              );
            })}
          </>
        )}
      </Box>
    </Box>
  );
}

// ---- public component ----------------------------------------------------
export default function SidebarNav({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileClose,
  favorites,
  isFavorite,
  toggleFavorite,
  recents,
  pushRecent,
}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down("lg"));
  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;
  const lastPushed = useRef(null);

  const favHelpers = { isFavorite, toggleFavorite, favorites, recents };

  // Record the current screen into recents whenever the route matches a nav item.
  useEffect(() => {
    const match = ALL_NAV_ITEMS.find((it) => isItemActive(it, location));
    if (match && lastPushed.current !== match.path) {
      lastPushed.current = match.path;
      pushRecent({ path: match.path, label: match.label });
    }
  }, [location, pushRecent]);

  const onNavigate = (item) => {
    navigate(item.path);
    if (isMobile && onMobileClose) onMobileClose();
  };

  // ---- Mobile: temporary drawer ----
  if (isMobile) {
    return (
      <Drawer
        anchor="left"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{
          sx: {
            width: SIDEBAR_WIDTH,
            backgroundColor: theme.palette.background.paper,
            borderRight: `1px solid ${theme.palette.divider}`,
            backgroundImage: "none",
          },
        }}
      >
        <SidebarContent
          collapsed={false}
          isMobile
          favHelpers={favHelpers}
          onNavigate={onNavigate}
          onClose={onMobileClose}
        />
      </Drawer>
    );
  }

  // ---- Desktop: permanent rail, sticky below the 64px top bar ----
  return (
    <Box
      component="nav"
      sx={{
        width,
        flexShrink: 0,
        transition: "width 0.2s cubic-bezier(0.4,0,0.2,1)",
        position: "sticky",
        top: 64,
        alignSelf: "flex-start",
        height: "calc(100vh - 64px)",
        borderRight: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
        display: "flex",
        flexDirection: "column",
        zIndex: 1100,
      }}
    >
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <SidebarContent
          collapsed={collapsed}
          favHelpers={favHelpers}
          onNavigate={onNavigate}
        />
      </Box>
      {/* Collapse toggle */}
      <Box
        sx={{
          borderTop: `1px solid ${theme.palette.divider}`,
          p: 0.75,
          display: "flex",
          justifyContent: collapsed ? "center" : "flex-end",
        }}
      >
        <Tooltip title={collapsed ? "Expand" : "Collapse"} placement="right">
          <IconButton size="small" onClick={onToggleCollapsed} sx={{ color: "text.secondary" }}>
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
