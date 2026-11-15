import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EarnPage } from "./pages/Earn";
import { LeaderboardPage } from "./pages/Leaderboard";
import { MarketPage } from "./pages/Market";
import { MarketsPage } from "./pages/Markets";
import { PortfolioPage } from "./pages/Portfolio";
import { ProposalsPage } from "./pages/Proposals";
import { TraderPage } from "./pages/Trader";
import { ActivityProvider } from "./state/activity";
import { ConnectionProviders } from "./state/connection";
import { DayStatsProvider, LiveAccountProvider } from "./state/data";
import { ThemeProvider } from "./state/theme";
import { TxProvider } from "./state/tx";

/** Hash routes, so any static host serves every page from one index.html without rewrite rules. */
export function App() {
  return (
    <ThemeProvider>
    <ActivityProvider>
    <ConnectionProviders>
      <LiveAccountProvider>
      <DayStatsProvider>
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
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/trader/:address" element={<TraderPage />} />
              {/* Profile's parts live on Portfolio, Proposals ("Yours") and the wallet's own account panel. */}
              <Route path="/profile" element={<Navigate to="/portfolio" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </HashRouter>
      </TxProvider>
      </DayStatsProvider>
      </LiveAccountProvider>
    </ConnectionProviders>
    </ActivityProvider>
    </ThemeProvider>
  );
}
