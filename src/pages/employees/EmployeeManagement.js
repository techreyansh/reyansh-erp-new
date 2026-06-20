import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Container, Typography, Chip, ToggleButtonGroup, ToggleButton, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Snackbar, Alert, CircularProgress,
} from "@mui/material";
import SpaceDashboardOutlined from "@mui/icons-material/SpaceDashboardOutlined";
import TableRowsOutlined from "@mui/icons-material/TableRowsOutlined";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import { usePermissions } from "../../context/PermissionContext";
import * as rbacService from "../../services/rbacService";
import { supabase } from "../../lib/supabaseClient";
import EmployeeDashboard from "../../components/employees/EmployeeDashboard";
import EmployeeDirectory from "../../components/employees/EmployeeDirectory";
import EmployeeProfile from "../../components/employees/EmployeeProfile";
import EmployeeOrgChart from "../../components/employees/EmployeeOrgChart";

export default function EmployeeManagement() {
  const permissions = usePermissions();
  const canManage = permissions?.canManageEmployees
    || permissions?.canEdit?.("employees") || permissions?.canCreate?.("employees");

  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");          // dashboard | directory | org
  const [selected, setSelected] = useState(null);          // employee -> profile
  const [profileTab, setProfileTab] = useState(0);
  const [snack, setSnack] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ full_name: "", email: "", department: "", designation: "", role_id: "" });
  const [saving, setSaving] = useState(false);

  const notify = (message, severity = "success") => setSnack({ message, severity });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, rls, perms] = await Promise.all([
        rbacService.listEmployees().catch(() => []),
        rbacService.listRoles().catch(() => []),
        rbacService.listAllEmployeePermissions ? rbacService.listAllEmployeePermissions().catch(() => []) : Promise.resolve([]),
      ]);
      const countByEmp = new Map();
      (perms || []).forEach((p) => {
        if (p.can_view) countByEmp.set(p.employee_id, (countByEmp.get(p.employee_id) || 0) + 1);
      });
      const rows = (emps || []).map((e) => ({
        ...e,
        role_name: e.roles?.name || e.roles?.role_name || e.role_name,
        moduleCount: countByEmp.get(e.id) || 0,
      }));
      setEmployees(rows);
      setRoles(rls || []);
      setSelected((prev) => (prev ? rows.find((r) => r.id === prev.id) || prev : prev));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEmployee = (emp, tab = 0) => { setSelected(emp); setProfileTab(tab); };

  const handleBulkSetStatus = async (ids, active) => {
    try {
      await Promise.all((ids || []).map((id) => rbacService.setEmployeeActive(id, active)));
      notify(`${ids.length} employee(s) set ${active ? "Active" : "Inactive"}`);
      load();
    } catch (e) { notify(e.message || "Failed", "error"); }
  };

  const handleExport = (rows) => {
    const data = (rows && rows.length ? rows : employees);
    const cols = ["employee_code", "full_name", "email", "phone", "department", "designation", "reporting_manager", "status", "joining_date"];
    const head = ["Employee ID", "Name", "Email", "Phone", "Department", "Designation", "Reporting Manager", "Status", "Join Date"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(","), ...data.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "employees.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleAdd = async () => {
    if (!addForm.full_name || !addForm.email) { notify("Name and email are required", "error"); return; }
    setSaving(true);
    try {
      const saved = await rbacService.saveEmployee({
        full_name: addForm.full_name, email: addForm.email.toLowerCase().trim(),
        department: addForm.department || null, role_id: addForm.role_id || null, is_active: true,
      });
      if (addForm.designation) {
        await supabase.from("employees_data").update({ Designation: addForm.designation }).eq("Email", addForm.email.toLowerCase().trim());
      }
      setAddOpen(false);
      setAddForm({ full_name: "", email: "", department: "", designation: "", role_id: "" });
      await load();
      notify("Employee added");
      if (saved?.id) openEmployee({ ...saved, moduleCount: 0 }, 2);
    } catch (e) { notify(e.message || "Failed to add", "error"); }
    finally { setSaving(false); }
  };

  if (permissions?.loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;
  }
  if (!canManage) {
    return (
      <Container sx={{ py: 6 }}>
        <Alert severity="warning">You don't have access to Employee Management.</Alert>
      </Container>
    );
  }

  if (selected) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <EmployeeProfile
          employee={selected}
          initialTab={profileTab}
          onBack={() => setSelected(null)}
          onSaved={() => { load(); notify("Saved"); }}
          onStatusChange={async (emp, active) => { await rbacService.setEmployeeActive(emp.id, active); load(); }}
        />
        <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)} variant="filled">{snack.message}</Alert> : undefined}
        </Snackbar>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Employee Management</Typography>
        <Chip size="small" label="CEO / HR" variant="outlined" color="primary" />
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(e, v) => v && setView(v)}>
          <ToggleButton value="dashboard"><SpaceDashboardOutlined sx={{ fontSize: 18, mr: 0.5 }} /> Dashboard</ToggleButton>
          <ToggleButton value="directory"><TableRowsOutlined sx={{ fontSize: 18, mr: 0.5 }} /> Directory</ToggleButton>
          <ToggleButton value="org"><AccountTreeOutlined sx={{ fontSize: 18, mr: 0.5 }} /> Org chart</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {view === "dashboard" && (
        <EmployeeDashboard
          employees={employees} loading={loading}
          onOpenEmployee={(e) => openEmployee(e)}
          onAddEmployee={() => setAddOpen(true)}
          onImport={() => notify("CSV import — coming soon", "info")}
          onAssignAccess={() => setView("directory")}
          onExport={() => handleExport()}
        />
      )}
      {view === "directory" && (
        <EmployeeDirectory
          employees={employees} loading={loading}
          onOpenEmployee={(e) => openEmployee(e)}
          onAddEmployee={() => setAddOpen(true)}
          onBulkSetStatus={handleBulkSetStatus}
          onBulkAssignAccess={(ids) => { const e = employees.find((x) => x.id === ids[0]); if (e) openEmployee(e, 2); }}
          onExport={handleExport}
        />
      )}
      {view === "org" && <EmployeeOrgChart employees={employees} onOpenEmployee={(e) => openEmployee(e)} />}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add employee</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gap: 2, mt: 1, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            <TextField label="Full name" required value={addForm.full_name} onChange={(e) => setAddForm({ ...addForm, full_name: e.target.value })} />
            <TextField label="Email (Google login)" required value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            <TextField label="Department" value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })} />
            <TextField label="Designation" value={addForm.designation} onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })} />
            <TextField select label="Role" value={addForm.role_id} onChange={(e) => setAddForm({ ...addForm, role_id: e.target.value })}>
              <MenuItem value="">— none —</MenuItem>
              {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name || r.role_name || r.code}</MenuItem>)}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={saving}>{saving ? "Adding…" : "Add employee"}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        {snack ? <Alert severity={snack.severity} onClose={() => setSnack(null)} variant="filled">{snack.message}</Alert> : undefined}
      </Snackbar>
    </Container>
  );
}
