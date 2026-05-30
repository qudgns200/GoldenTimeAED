interface Props {
  message?: string;
}

export function LoadingOverlay({ message = '불러오는 중...' }: Props) {
  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
      <p className="loading-message">{message}</p>
    </div>
  );
}
