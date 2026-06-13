import React from "react";
import { Button, FormControl, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack, TextField } from "@mui/material";
import { Download, FilterList, Save, Search } from "@mui/icons-material";

/**
 * Shared controls bar for the CRM/PPC enterprise panels.
 * One clean outlined card: search + role on the left, view-save + filters +
 * export on the right, wrapping gracefully on small screens.
 */
const EnterpriseToolbar = ({
  search,
  setSearch,
  role,
  setRole,
  onExport,
  viewName,
  setViewName,
  onSaveView,
  children,
}) => (
  <Paper variant="outlined" sx={{ borderRadius: 2.5, p: { xs: 1.5, md: 2 } }}>
    <Stack
      direction={{ xs: "column", lg: "row" }}
      spacing={1.5}
      alignItems={{ lg: "center" }}
      justifyContent="space-between"
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
        <TextField
          size="small"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { sm: 220 }, flex: { sm: 1 }, maxWidth: 320 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 18, color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Role</InputLabel>
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            <MenuItem value="Admin">Admin</MenuItem>
            <MenuItem value="Sales">Sales</MenuItem>
            <MenuItem value="Production">Production</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Name this view"
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          sx={{ width: { xs: "100%", sm: 180 } }}
        />
        <Button size="small" startIcon={<Save sx={{ fontSize: 18 }} />} onClick={onSaveView} sx={{ textTransform: "none" }}>
          Save view
        </Button>
        <Button size="small" startIcon={<FilterList sx={{ fontSize: 18 }} />} variant="outlined" sx={{ textTransform: "none" }}>
          Filters
        </Button>
        <Button size="small" startIcon={<Download sx={{ fontSize: 18 }} />} variant="outlined" onClick={onExport} sx={{ textTransform: "none" }}>
          Export CSV
        </Button>
      </Stack>
    </Stack>
    {children}
  </Paper>
);

export default EnterpriseToolbar;
