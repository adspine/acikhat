import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Sayfa çizilirken beklenmedik bir hata olursa tüm ekran boşalmasın: hata ve çıkış yolu gösterilir.
 * Üst bileşen `key` olarak sayfa yolunu verir; başka sayfaya geçince hata durumu kendiliğinden sıfırlanır.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[panel] sayfa hatası:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="page narrow" role="alert">
        <div className="card crash">
          <h1 className="page-title">Bu sayfada bir sorun oluştu</h1>
          <p className="muted">Sayfayı yenileyip tekrar deneyin. Sorun sürerse aşağıdaki hata metnini bize iletin.</p>
          <pre className="crash-detail">{error.message || String(error)}</pre>
          <div className="row-actions">
            <button type="button" className="btn btn-quiet" onClick={() => this.setState({ error: null })}>Tekrar dene</button>
            <button type="button" className="btn btn-primary" onClick={() => location.assign("/panel/")}>Ana sayfaya dön</button>
          </div>
        </div>
      </section>
    );
  }
}
