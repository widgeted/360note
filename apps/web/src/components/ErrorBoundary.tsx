import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getLocale } from '../lib/i18n';

interface State {
  error: Error | null;
}

/**
 * Last-resort UI recovery. A rendering failure in one screen must not leave a
 * white page with no path back to the app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const zh = getLocale() === 'zh-CN';
    return (
      <div className="editor-empty" role="alert">
        <div className="editor-empty-mark">!</div>
        <div className="editor-empty-title">{zh ? '页面暂时无法显示' : 'This page could not be displayed'}</div>
        <p className="editor-empty-text">{zh ? '本地草稿仍保存在这台设备上。可以返回应用重试，或复制错误信息反馈。' : 'Your local drafts are still on this device. Return to the app or copy the error details for support.'}</p>
        <div className="editor-empty-actions editor-empty-actions-primary">
          <button type="button" className="btn btn-primary" onClick={() => { this.setState({ error: null }); window.location.assign('/app'); }}>{zh ? '返回应用' : 'Back to app'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>{zh ? '重新加载' : 'Reload'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(`${this.state.error?.message}\n${this.state.error?.stack ?? ''}`)}>{zh ? '复制错误信息' : 'Copy error details'}</button>
        </div>
      </div>
    );
  }
}
