// Workstream C replaces this stub (dashboard UI).
import { createRoot } from "react-dom/client";
import { PORTS } from "@pennyagent/shared";

createRoot(document.getElementById("root")!).render(
  <main style={{ fontFamily: "system-ui", padding: 24 }}>
    <h1>PennyAgent</h1>
    <p>Web stub. Agent expected on port {PORTS.agent}.</p>
  </main>,
);
