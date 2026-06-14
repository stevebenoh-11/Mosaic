import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary: a render error in any card/view shows a recovery
 * screen instead of white-screening the whole app. Data lives in IndexedDB,
 * so a reload is always safe.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unrecoverable render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-lg font-semibold">Something went wrong</div>
        <div className="max-w-md text-sm text-ink-soft">
          The app hit an unexpected error. Your boards are saved locally —
          reloading is safe.
        </div>
        <button
          type="button"
          className="mt-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </div>
    );
  }
}
