interface Props {
  onClick: () => void;
  isLoading: boolean;
}

export function LocationButton({ onClick, isLoading }: Props) {
  return (
    <button
      className="location-button"
      onClick={onClick}
      disabled={isLoading}
      aria-label="내 위치로 이동"
      title="내 위치로 이동"
    >
      📍
    </button>
  );
}
