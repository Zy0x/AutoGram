import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import i18n from '../../i18n';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    const isDynamicImportError =
      this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
      this.state.error?.name === 'TypeError';

    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }

    if (isDynamicImportError) {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <main className="main-content page-stack" style={{ padding: '2rem' }}>
          <div
            className="glass-panel card"
            style={{
              padding: '2rem',
              maxWidth: '640px',
              margin: '2rem auto',
              borderColor: 'rgba(239, 68, 68, 0.4)',
              background: 'rgba(239, 68, 68, 0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#ef4444', marginBottom: '1rem' }}>
              <AlertTriangle size={28} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>
                {this.props.fallbackTitle || i18n.t('nav.error_fallback_title', 'Terjadi Kesalahan Komponen UI')}
              </h3>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '1rem' }}>
              {this.state.error?.message || i18n.t('nav.error_default_desc', 'Aplikasi mengalami kendala tak terduga saat memuat bagian ini.')}
            </p>

            {this.state.error && (
              <pre
                style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: '1rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  color: '#f87171',
                  overflowX: 'auto',
                  maxHeight: '180px',
                  marginBottom: '1.25rem',
                }}
              >
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={this.handleReset}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <RefreshCw size={16} />
                {i18n.t('nav.error_retry', 'Coba Lagi / Muat Ulang')}
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
