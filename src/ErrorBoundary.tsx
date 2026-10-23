import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowDownToLine, RotateCcw, ShieldCheck } from "lucide-react";
import { readBrowserState, resetBrowserDemo } from "./browserDemo";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  actionError: string | null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    actionError: null,
  };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error:
        error instanceof Error
          ? error
          : new Error("Unknown application error."),
      actionError: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("RelaySafe application error", error, errorInfo);
  }

  private resetDemo = () => {
    resetBrowserDemo();
    if (typeof globalThis.location?.reload === "function") {
      globalThis.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, actionError: null });
  };

  private exportState = () => {
    try {
      if (
        typeof globalThis.Blob === "undefined" ||
        typeof globalThis.URL === "undefined" ||
        typeof globalThis.document === "undefined"
      )
        throw new Error("State export is unavailable in this browser.");

      const state = readBrowserState();
      const blob = new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), ...state },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relaysafe-audit-v${state.version}.json`;
      anchor.click();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.setState({ actionError: null });
    } catch {
      this.setState({
        actionError: "State export is unavailable in this browser.",
      });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="error-boundary">
        <section
          className="app-dialog error-boundary-dialog"
          role="alert"
          aria-labelledby="error-boundary-title"
        >
          <span className="eyebrow">
            <ShieldCheck size={13} /> SAFETY RECOVERY
          </span>
          <h1 id="error-boundary-title">The relay needs a fresh start.</h1>
          <p>
            RelaySafe stopped rendering safely. Your browser-local snapshot can
            be exported before resetting the demo.
          </p>
          <div className="dialog-actions error-boundary-actions">
            <button className="button secondary" onClick={this.exportState}>
              <ArrowDownToLine size={15} /> Export state JSON
            </button>
            <button className="button primary" onClick={this.resetDemo}>
              <RotateCcw size={15} /> Reset demo
            </button>
          </div>
          {this.state.actionError && (
            <p className="error-boundary-action-error" role="status">
              {this.state.actionError}
            </p>
          )}
          <details className="error-boundary-details">
            <summary>Technical details</summary>
            <code>
              {this.state.error?.message ?? "Unknown application error."}
            </code>
          </details>
        </section>
      </main>
    );
  }
}
