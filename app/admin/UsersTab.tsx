"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  approval_status: "pending" | "approved" | "rejected";
  created_at: string;
  project_count: number;
};

export default function UsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not load users.");
      return;
    }
    setError(null);
    setUsers(json.users);
    setTruncated(!!json.truncated);
  }

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

  async function setApproval(userId: string, approval_status: "approved" | "rejected") {
    setActingId(userId);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, approval_status }),
    });
    const json = await res.json();
    setActingId(null);
    if (!res.ok) {
      setError(json.error || "Could not update that account.");
      return;
    }
    await load();
  }

  return (
    <div className="panel">
      <p className="hint" style={{ marginBottom: 14 }}>
        New sign-ups need approval here before they can use InkFrame. Roles aren&apos;t editable through the
        app — promote an admin from the Supabase dashboard directly (see <code>supabase/README.md</code>).
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
                <th>Approval</th>
                <th>Joined</th>
                <th>Projects</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "admin" : "user"}`}>{u.role}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        u.approval_status === "approved" ? "active" : u.approval_status === "rejected" ? "admin" : "locked"
                      }`}
                    >
                      {u.approval_status}
                    </span>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>{u.project_count}</td>
                  <td>
                    {u.approval_status !== "approved" && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: "6px 12px", fontSize: 12, marginRight: 6 }}
                        disabled={actingId === u.id}
                        onClick={() => setApproval(u.id, "approved")}
                      >
                        Approve
                      </button>
                    )}
                    {u.approval_status !== "rejected" && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        disabled={actingId === u.id}
                        onClick={() => setApproval(u.id, "rejected")}
                      >
                        Reject
                      </button>
                    )}
                  </td>
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
