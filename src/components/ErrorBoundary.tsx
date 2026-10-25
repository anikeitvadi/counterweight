import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Keeps one broken chart from taking the whole desk down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Counterweight] ${this.props.title} crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="panel">
          <div className="ph">
            <h3>{this.props.title}</h3>
          </div>
          <div className="empty">
            This panel hit an error and was paused.{' '}
            <button className="link" onClick={() => this.setState({ error: null })}>Retry</button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
