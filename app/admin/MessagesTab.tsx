"use client";

import { useEffect, useState } from "react";

type AdminUser = { id: string; email: string };
type AdminMessage = { id: string; target_user_id: string | null; target_email: string | null; body: string; created_at: string };

export default function MessagesTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [messages, setMessages] = useState<AdminMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMessages() {
    const res = await fetch("/api/admin/messages");
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not load messages.");
      return;
    }
    setMessages(json.messages);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [usersRes, messagesRes] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/messages")]);
      const usersJson = await usersRes.json();
      const messagesJson = await messagesRes.json();
      if (cancelled) return;
      if (usersRes.ok) setUsers(usersJson.users.map((u: AdminUser) => ({ id: u.id, email: u.email })));
      if (messagesRes.ok) setMessages(messagesJson.messages);
      else setError(messagesJson.error || "Could not load messages.");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/admin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, target_user_id: targetUserId || null }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(json.error || "Could not send that message.");
      return;
    }
    setBody("");
    setTargetUserId("");
    await loadMessages();
  }

  async function remove(id: string) {
    setDeletingId(id);
    const res = await fetch("/api/admin/messages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const json = await res.json();
    setDeletingId(null);
    if (!res.ok) {
      setError(json.error || "Could not delete that message.");
      return;
    }
    await loadMessages();
  }

  return (
    <div className="panel">
      <p className="hint" style={{ marginBottom: 14 }}>
        Send a message to one user, or leave the recipient as &quot;All Users&quot; to broadcast — it shows up
        in the recipient&apos;s notification bell on their dashboard.
      </p>
      {error && (
        <p className="hint" style={{ color: "var(--redGlow)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <select
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          style={{
            padding: "10px",
            borderRadius: "8px",
            background: "var(--panel2, var(--panel))",
            color: "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          <option value="">All Users (broadcast)</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message…"
          rows={3}
          style={{
            padding: "10px",
            borderRadius: "8px",
            background: "var(--panel2, var(--panel))",
            color: "var(--text)",
            border: "1px solid var(--border)",
            resize: "vertical",
            font: "inherit",
          }}
        />
        <button className="btn btn-primary" disabled={sending || !body.trim()} onClick={send} style={{ alignSelf: "flex-start" }}>
          {sending ? "Sending…" : "Send Message"}
        </button>
      </div>

      {messages === null && <p className="hint">Loading…</p>}
      {messages && messages.length === 0 && <p className="hint">No messages sent yet.</p>}
      {messages && messages.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>To</th>
                <th>Message</th>
                <th>Sent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td>{m.target_email ?? "All Users"}</td>
                  <td style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{m.body}</td>
                  <td>{new Date(m.created_at).toLocaleString()}</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={deletingId === m.id}
                      onClick={() => remove(m.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
