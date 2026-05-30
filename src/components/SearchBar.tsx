import { useState, type FormEvent } from 'react';

interface Props {
  onSearch: (query: string) => void;
  isLoading: boolean;
}

export function SearchBar({ onSearch, isLoading }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSearch(trimmed);
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search">
      <input
        type="text"
        className="search-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="주소 또는 장소를 입력하세요"
        aria-label="위치 검색"
        disabled={isLoading}
      />
      <button
        type="submit"
        className="search-button"
        aria-label="검색"
        disabled={isLoading || !value.trim()}
      >
        🔍
      </button>
    </form>
  );
}
