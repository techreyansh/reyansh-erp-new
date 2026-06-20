import React, { useEffect, useRef, useState } from "react";
import { Snackbar, Alert, Button } from "@mui/material";

/**
 * Detects when a newer build has been deployed and offers a one-click reload,
 * so users are never stuck on a stale cached version.
 *
 * Compares the CURRENTLY-RUNNING main bundle (read from the DOM) against the
 * latest deployed build/asset-manifest.json (fetched no-store). If they differ,
 * the running tab is on an older build -> offer a refresh.
 */
function runningMainPath() {
  const scripts = Array.from(document.getElementsByTagName("script"));
  const main = scripts
    .map((s) => s.getAttribute("src") || "")
    .find((src) => /\/static\/js\/main\.[A-Za-z0-9]+\.js/.test(src));
  if (!main) return null;
  try { return new URL(main, window.location.origin).pathname; } catch { return main; }
}

async function latestMainPath() {
  try {
    const res = await fetch("/asset-manifest.json", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const m = json && json.files && json.files["main.js"];
    if (!m) return null;
    try { return new URL(m, window.location.origin).pathname; } catch { return m; }
  } catch {
    return null;
  }
}

export default function VersionGate() {
  const runningRef = useRef(runningMainPath());
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const latest = await latestMainPath();
      const running = runningRef.current;
      if (active && latest && running && latest !== running) setUpdateReady(true);
    };
    check(); // check immediately on load (catches users opening a stale cached tab)
    const iv = setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(iv); window.removeEventListener("focus", check); };
  }, []);

  if (!updateReady) return null;
  return (
    <Snackbar open anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert
        severity="info"
        variant="filled"
        action={
          <Button color="inherit" size="small" onClick={() => window.location.reload()}>
            Refresh now
          </Button>
        }
      >
        A new version of the ERP is available.
      </Alert>
    </Snackbar>
  );
}
