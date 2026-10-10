export default function LoadingStatus({ label, detail }: { label: string; detail?: string }) {
  return <div className="loading-status" role="status" aria-live="polite">
    <span className="loading-spinner" aria-hidden="true" />
    <div><strong>{label}</strong>{detail && <span>{detail}</span>}</div>
  </div>;
}
