import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { SuperAdminApp } from "./app/pages/superadmin/SuperAdminApp.tsx";
import "./styles/index.css";
import { StoreProvider } from "./context/StoreContext";
import { AuthProvider } from "./context/AuthContext";

const isSuperAdminPath = window.location.pathname.startsWith("/superadmin");

createRoot(document.getElementById("root")!).render(
  isSuperAdminPath
    ? <SuperAdminApp />
    : (
      <AuthProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </AuthProvider>
    )
);
