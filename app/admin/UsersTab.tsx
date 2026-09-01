"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  project_count: number;
};

export default function UsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error || "Could not load users.");
        return;
      }
      setUsers(json.users);
      setTruncated(!!json.truncated);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel">
      <p className="hint" style={{ marginBottom: 14 }}>
        Read-only — roles aren&apos;t editable through the app. Promote an admin from the Supabase dashboard
        directly (see <code>supabase/README.md</code>).
      </p>
      {error && <p className="hint" style={{ color: "var(--redGlow)" }}>{error}</p>}
      {users === null && !error && <p className="hint">Loading…</p>}
      {users && (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Projects</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "admin" : "user"}`}>{u.role}</span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>{u.project_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && <p className="hint" style={{ marginTop: 12 }}>Showing the first 200 users only.</p>}
    </div>
  );
}
