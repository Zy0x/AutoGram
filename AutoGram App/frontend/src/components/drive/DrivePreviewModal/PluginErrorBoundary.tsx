import { Component, ErrorInfo, ReactNode } from 'react';
import i18n from 'i18next';
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
              <h3>{i18n.t('drive.plugin_error_degraded', { plugin: this.props.pluginName })}</h3>
              <p className="td-plugin-error-msg">
                {this.state.error?.message || i18n.t('drive.plugin_error_unexpected')}
              </p>
              <div className="td-plugin-error-actions">
                <button
                  type="button"
                  className="td-btn-secondary td-btn-sm"
                  onClick={this.handleRetry}
                >
                  <RefreshCw size={13} />
                  <span>{i18n.t('drive.plugin_retry')}</span>
                </button>
                {this.props.fallbackToRaw && (
                  <button
                    type="button"
                    className="td-btn-secondary td-btn-sm"
                    onClick={this.props.fallbackToRaw}
                  >
                    <FileCode size={13} />
                    <span>{i18n.t('drive.plugin_view_raw')}</span>
                  </button>
                )}
                {this.props.fallbackToHex && (
                  <button
                    type="button"
                    className="td-btn-primary td-btn-sm"
                    onClick={this.props.fallbackToHex}
                  >
                    <Binary size={13} />
                    <span>{i18n.t('drive.plugin_hex_inspector')}</span>
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
