import { Component, type ReactNode } from 'react';
import { Button } from '../design/primitives/index.js';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="error-boundary" role="alert"><div>
      <h1>Something went wrong</h1><p>This screen could not be displayed. Retry it or reload the application.</p>
      <div className="button-row"><Button onClick={() => this.setState({ failed: false })}>Retry screen</Button><Button variant="secondary" onClick={() => window.location.reload()}>Reload application</Button></div>
    </div></main>;
    return this.props.children;
  }
}
