export function ShellMessage({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <main className="auth-layout">
      <section className="auth-card">
        <h1>{title}</h1>
        {subtitle ? <p className="subtle-text">{subtitle}</p> : null}
      </section>
    </main>
  );
}
