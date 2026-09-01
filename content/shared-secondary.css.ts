// Shared chrome for secondary pages that have no approved mockup of their
// own (My Books, Cover Designer, Formatter, Research, Metadata, Compliance
// Check, Settings, Help & Support). Every token/class here is lifted
// directly from the approved pages (advertising.html, translate.html) —
// same --bg/--panel/--border/--blue/--red variables, same header/wrap/
// panel/btn/catalog-row structure — so nothing here introduces a new
// visual language, just reuses the one already approved.
export const sharedSecondaryCss = `
* { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, Inter, Arial, sans-serif; }
:root {
  --bg:#030914; --panel:#0a1526; --panel2:#08111f; --border:#16233a;
  --blue:#2f6fed; --blueGlow:#4c8bff; --red:#e23b4c; --redGlow:#ff5566;
  --ink:#f5f6fa; --muted:#8d96ab;
}
body { background:var(--bg); color:var(--ink); min-height:100vh; }
header { border-bottom:1px solid var(--border); padding:18px 28px; display:flex; align-items:center; justify-content:space-between; }
.logo { font-weight:800; font-size:18px; }
.logo .ink{color:var(--blue)} .logo .frame{color:var(--red)}
.back-btn { background:rgba(255,255,255,.04); border:1px solid var(--border); color:var(--ink);
  padding:9px 16px; border-radius:9px; font-size:13px; cursor:pointer; }

.wrap { max-width:900px; margin:0 auto; padding:36px 24px 60px; }
h1 { font-size:24px; font-weight:800; margin-bottom:6px; }
.subtitle { color:var(--muted); font-size:14px; margin-bottom:28px; }

.panel { background:var(--panel); border:1px solid var(--border); border-radius:16px; padding:22px; margin-bottom:20px; }
.hint { font-size:11.5px; color:var(--muted); }

.empty-panel { background:var(--panel); border:1px dashed var(--border); border-radius:16px; padding:40px 24px;
  text-align:center; margin-bottom:24px; }
.empty-panel .ei { font-size:32px; margin-bottom:12px; }
.empty-panel h3 { margin-bottom:6px; }
.empty-panel p { color:var(--muted); font-size:13px; margin-bottom:18px; }

.btn { padding:12px 20px; border-radius:10px; font-weight:700; font-size:13.5px; border:none; cursor:pointer; }
.btn-primary { background:linear-gradient(135deg,var(--blueGlow),var(--blue)); color:#fff;
  box-shadow:0 10px 26px -8px rgba(47,111,237,.6); }
.btn-secondary { background:rgba(255,255,255,.04); border:1px solid var(--border); color:var(--ink); }
.btn:disabled { opacity:.4; cursor:not-allowed; }

.catalog-row { display:flex; align-items:center; gap:14px; padding:14px; border:1px solid var(--border);
  border-radius:12px; margin-bottom:10px; cursor:pointer; transition:.15s; }
.catalog-row:hover { border-color:#26406b; }
.catalog-row.selected { border-color:var(--blueGlow); background:rgba(76,139,255,.06); }
.status-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.status-dot.none { background:#5a6280; }
.status-dot.ok { background:#5fe3b8; }
.status-dot.warn { background:#ffc266; }
.catalog-row .bname { font-weight:600; font-size:13.5px; }
.catalog-row .bstatus { font-size:11.5px; color:var(--muted); }

.check-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; font-size:13.5px; border-top:1px solid var(--border); }
.check-row:first-child { border-top:none; }
.check-row .ok { color:#5fe3b8; font-weight:700; }

.safety-note { background:rgba(76,139,255,.06); border:1px solid rgba(76,139,255,.2); border-radius:12px;
  padding:14px 16px; font-size:12px; color:#c8d4ee; line-height:1.6; margin-top:8px; }

.field { margin-bottom:18px; }
label { display:block; font-size:12.5px; font-weight:600; margin-bottom:6px; color:#dbe1ee; }
.field input { width:100%; background:#0d1626; border:1px solid var(--border);
  border-radius:10px; padding:11px 14px; color:#fff; font-size:13.5px; outline:none; font-family:inherit; }
.field input:focus { border-color:var(--blueGlow); box-shadow:0 0 0 3px rgba(76,139,255,.18); }

@media (max-width:640px) { .wrap { padding:24px 16px 40px; } }
`;
