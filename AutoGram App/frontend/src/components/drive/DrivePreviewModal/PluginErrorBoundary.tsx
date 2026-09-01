import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, FileCode, Binary } from 'lucide-react';

interface Props {
  pluginName: string;
  fallbackToRaw?: () => void;
  fallbackToHex?: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PluginErrorBoundary:${this.props.pluginName}] caught error:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="td-plugin-error-fallback" role="alert">
          <div className="td-plugin-error-card">
            <div className="td-plugin-error-icon">
              <AlertTriangle size={28} className="text-amber-400" />
            </div>
            <div className="td-plugin-error-content">
              <h3>Format Viewer Degraded ({this.props.pluginName})</h3>
              <p className="td-plugin-error-msg">
                {this.state.error?.message || 'An unexpected error occurred while parsing this file format.'}
              </p>
              <div className="td-plugin-error-actions">
                <button
                  type="button"
                  className="td-btn-secondary td-btn-sm"
                  onClick={this.handleRetry}
                >
                  <RefreshCw size={13} />
                  <span>Coba Lagi</span>
                </button>
                {this.props.fallbackToRaw && (
                  <button
                    type="button"
                    className="td-btn-secondary td-btn-sm"
                    onClick={this.props.fallbackToRaw}
                  >
                    <FileCode size={13} />
                    <span>Lihat Teks Mentah</span>
                  </button>
                )}
                {this.props.fallbackToHex && (
                  <button
                    type="button"
                    className="td-btn-primary td-btn-sm"
                    onClick={this.props.fallbackToHex}
                  >
                    <Binary size={13} />
                    <span>Inspektor Hex</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
