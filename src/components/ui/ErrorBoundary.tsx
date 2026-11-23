import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Prevents an uncaught render exception inside a workspace view from blanking
 * the whole application shell, offering a safe retry and page reload fallback.
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error('RacePulsePH UI error boundary triggered:', error?.name || 'Error');
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="min-h-[240px] flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-center space-y-4">
            <h2 className="text-lg font-semibold font-display text-[var(--text-primary)]">
              {this.props.title || 'Something interrupted this view'}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Your saved race data is safe. Retry rendering this panel or reload the app.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="min-h-11 px-5 rounded-xl bg-red-700 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-sm font-semibold text-[var(--text-primary)] transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
