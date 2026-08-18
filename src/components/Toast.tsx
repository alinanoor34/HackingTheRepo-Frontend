import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../context/NotificationContext";
import "./Toast.css";

const AUTO_DISMISS_MS = 6000;

export default function Toasts(): React.ReactElement | null {
  const { notifications, markRead } = useNotifications();
  const navigate = useNavigate();

  const unread = notifications.filter((n) => !n.read).slice(0, 4);

  // Auto-dismiss each visible toast after a few seconds
  useEffect(() => {
    const timers = unread.map((n) =>
      setTimeout(() => markRead(n.id), AUTO_DISMISS_MS)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.map((n) => n.id).join(",")]);

  if (unread.length === 0) return null;

  const handleClick = (n: (typeof unread)[number]) => {
    markRead(n.id);
    const jobId = n.meta?.jobId;
    if (typeof jobId === "string") {
      navigate(`/jobs/${jobId}`);
    }
  };

  return (
    <div className="toast-wrap" aria-live="polite">
      {unread.map((n) => (
        <div
          key={n.id}
          className={`toast toast-${n.kind || "info"}`}
          onClick={() => handleClick(n)}
          role="button"
          tabIndex={0}
        >
          <div className="toast-body">
            <div className="toast-title">{n.title}</div>
            {n.body && <div className="toast-text">{n.body}</div>}
          </div>
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation();
              markRead(n.id);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}