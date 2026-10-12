// This App was build by i729 - Fumakill4
import React from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Conversations from './pages/Conversations';
import Expenses from './pages/Expenses';
import Dompet from './pages/Dompet';
import Categories from './pages/Categories';
import Analytics from './pages/Analytics';
import WaFinanceM3Demo from './pages/WaFinanceM3Demo';
import SetupGuide from './pages/SetupGuide';
import WhatsApp from './pages/WhatsApp';
import Login from './pages/Login';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { ThemeProvider } from './context/ThemeContext';
import { SidebarProvider } from './context/SidebarContext';
import { FilterProvider } from './context/FilterContext';

function ProtectedApp() {
  const { user, loading } = useAuth();
  const isPublicDemo = window.location.pathname === '/m3-demo';

  if (isPublicDemo) {
    return (
      <BrowserRouter>
        <main className="min-h-screen bg-[#071019]">
          <Routes>
            <Route path="/m3-demo" element={<WaFinanceM3Demo />} />
            <Route path="*" element={<Navigate to="/m3-demo" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#071019] text-sm text-slate-400">Memeriksa sesi...</div>;
  }

  if (!user) return <Login />;

  return (
    <BrowserRouter>
      <div className="app-shell flex min-h-screen overflow-hidden bg-[#f5faeb] font-sans text-slate-800 dark:bg-[#071019] dark:text-slate-200">

        <Sidebar />

        <main className="app-main relative h-screen flex-1 overflow-y-auto px-6 py-7 lg:px-9 lg:py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/dompet" element={<Dompet />} />
            <Route path="/wallets" element={<Dompet />} />
            <Route path="/categories" element={<Dompet />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/m3-demo" element={<WaFinanceM3Demo />} />
            <Route path="/setup" element={<SetupGuide />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("WebApp ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#071019] p-6 text-center text-slate-200">
          <div className="max-w-md rounded-2xl border border-emerald-500/30 bg-[#0d1821] p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-emerald-400">Aplikasi Perlu Diperbarui</h2>
            <p className="mt-3 text-sm text-slate-400">Sistem baru saja melakukan pembaruan versi. Silakan klik tombol di bawah untuk memuat ulang aplikasi.</p>
            <button
              onClick={() => { window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now(); }}
              className="mt-6 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-[#052216] transition hover:bg-emerald-400"
            >
              Muat Ulang Halaman (Reload)
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <SidebarProvider>
            <FilterProvider>
              <ProtectedApp />
            </FilterProvider>
          </SidebarProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
