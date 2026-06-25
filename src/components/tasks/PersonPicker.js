import React, { useEffect, useMemo, useState } from "react";
import {
  Autocomplete, TextField, Box, Avatar, Chip, Typography, Stack, Button, CircularProgress,
} from "@mui/material";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import { supabase } from "../../lib/supabaseClient";

/**
 * Person-first assignee picker. Search by name / role / department; each option
 * shows avatar + name + role, with the DEPARTMENT and live OPEN-TASK workload on
 * the right. Includes "Assign to me" and remembers recent assignees.
 *
 * Props:
 *  - value: selected email (string) or person object
 *  - onChange(person|null): person = { email, full_name, department, role, phone, open_tasks }
 *  - label, size, fullWidth, currentUserEmail
 */
const RECENT_KEY = "reyansh.task.recentAssignees";
function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } }
function pushRecent(email) {
  try {
    const r = getRecent().filter((e) => e !== email);
    r.unshift(email);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 5)));
  } catch { /* ignore */ }
}
function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function loadColor(n) { if (n >= 8) return "error"; if (n >= 4) return "warning"; return "success"; }

export default function PersonPicker({
  value, onChange, label = "Assign to", size = "medium", fullWidth = true, currentUserEmail,
}) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.rpc("task_assignable_users");
        if (active) setUsers(Array.isArray(data) ? data : []);
      } catch { /* ignore */ } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const options = useMemo(() => {
    const recent = getRecent();
    const byEmail = new Map(users.map((u) => [u.email, u]));
    const rec = recent.map((e) => byEmail.get(e)).filter(Boolean);
    const rest = users.filter((u) => !recent.includes(u.email));
    return [...rec, ...rest];
  }, [users]);

  const valueEmail = typeof value === "string" ? value : value?.email;
  const selected = useMemo(() => {
    if (!valueEmail) return null;
    return users.find((u) => u.email === String(valueEmail).toLowerCase())
      || { email: valueEmail, full_name: (typeof value === "object" && value?.full_name) || valueEmail };
  }, [users, valueEmail, value]);

  const me = currentUserEmail ? users.find((u) => u.email === String(currentUserEmail).toLowerCase()) : null;

  const select = (u) => { if (u) pushRecent(u.email); onChange?.(u || null); };

  return (
    <Box>
      <Autocomplete
        fullWidth={fullWidth}
        size={size}
        loading={loading}
        options={options}
        value={selected}
        onChange={(e, v) => select(v)}
        getOptionLabel={(o) => o?.full_name || o?.email || ""}
        isOptionEqualToValue={(o, v) => o?.email === v?.email}
        filterOptions={(opts, { inputValue }) => {
          const q = inputValue.toLowerCase().trim();
          if (!q) return opts;
          return opts.filter((o) =>
            [o.full_name, o.department, o.role, o.email].some((f) => String(f || "").toLowerCase().includes(q)));
        }}
        renderInput={(p) => (
          <TextField
            {...p}
            label={label}
            placeholder="Type a name, role or department…"
            InputProps={{
              ...p.InputProps,
              endAdornment: (<>{loading ? <CircularProgress size={16} /> : null}{p.InputProps.endAdornment}</>),
            }}
          />
        )}
        renderOption={(props, o) => (
          <Box component="li" {...props} key={o.email}>
            <Avatar sx={{ width: 32, height: 32, mr: 1.5, fontSize: 13, bgcolor: "primary.main" }}>
              {initials(o.full_name)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{o.full_name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>{o.role || "—"}</Typography>
            </Box>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 1 }}>
              {o.department && <Chip size="small" label={o.department} variant="outlined" />}
              {typeof o.open_tasks === "number" && (
                <Chip size="small" color={loadColor(o.open_tasks)} label={`${o.open_tasks} open`} />
              )}
            </Stack>
          </Box>
        )}
      />
      {me && (!selected || selected.email !== me.email) && (
        <Button size="small" startIcon={<PersonAddAlt1Icon />} onClick={() => select(me)} sx={{ mt: 0.5 }}>
          Assign to me
        </Button>
      )}
    </Box>
  );
}
