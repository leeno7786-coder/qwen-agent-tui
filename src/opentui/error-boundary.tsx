/** @jsxImportSource @opentui/react */

import React from 'react';
import type { Theme } from './theme.js';

interface Props {
  children: React.ReactNode;
  theme?: Theme;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
    // Error captured in state for rendering fallback UI
  }

  render() {
    if (this.state.hasError) {
      return (
        <box flexDirection="column" paddingX={2} paddingY={1}>
          <text fg={this.props.theme?.errorFg ?? '#f7768e'}>
            Error: {this.state.error?.message || 'Unknown error'}
          </text>
        </box>
      );
    }
    return this.props.children;
  }
}
