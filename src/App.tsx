import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EarnPage } from "./pages/Earn";
import { MarketPage } from "./pages/Market";
import { MarketsPage } from "./pages/Markets";
import { PortfolioPage } from "./pages/Portfolio";
import { ProfilePage } from "./pages/Profile";
import { ProposalsPage } from "./pages/Proposals";
import { ConnectionProviders } from "./state/connection";
import { LiveAccountProvider } from "./state/data";
import { ThemeProvider } from "./state/theme";
import { TxProvider } from "./state/tx";

/** Hash routes, so any static host serves every page from one index.html without rewrite rules. */
export function App() {
  return (
    <ThemeProvider>
    <ConnectionProviders>
      <LiveAccountProvider>
      <TxProvider>
        <HashRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<MarketsPage />} />
              <Route path="/market/:address" element={<MarketPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/earn" element={<EarnPage />} />
              <Route path="/proposals" element={<ProposalsPage />} />
              <Route path="/governance" element={<Navigate to="/proposals" replace />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </HashRouter>
      </TxProvider>
      </LiveAccountProvider>
    </ConnectionProviders>
    </ThemeProvider>
  );
}
