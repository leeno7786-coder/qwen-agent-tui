import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
/** @jsxImportSource @opentui/react */
import React from 'react';
export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(_error, _errorInfo) {
        // Error captured in state for rendering fallback UI
    }
    render() {
        if (this.state.hasError) {
            return (_jsx("box", { flexDirection: "column", paddingX: 2, paddingY: 1, children: _jsxs("text", { fg: this.props.theme?.errorFg ?? '#f7768e', children: ["Error: ", this.state.error?.message || 'Unknown error'] }) }));
        }
        return this.props.children;
    }
}
