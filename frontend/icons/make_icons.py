"""PWA 아이콘 PNG를 생성한다. 결과물(icon-*.png)은 커밋되어 있으므로 평소엔 실행할 필요가 없다.

디자인을 바꿀 때만 다시 돌린다:
    python frontend/icons/make_icons.py

Pillow 같은 이미지 라이브러리를 쓰지 않고 stdlib(zlib)만으로 PNG를 직접 쓴다.
아이콘 3개 때문에 빌드 의존성을 늘리지 않기 위해서다.
번개 모양은 index.html의 인라인 SVG 파비콘(⚡)과 정체성을 맞춘 것이다.
"""
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent

BACKGROUND = (217, 45, 32)  # --accent (#d92d20)
FOREGROUND = (255, 255, 255)

# 0~1 정규 좌표계의 번개 폴리곤 (y는 아래로 증가).
BOLT = [
    (0.58, 0.06),
    (0.26, 0.56),
    (0.45, 0.56),
    (0.40, 0.94),
    (0.74, 0.44),
    (0.55, 0.44),
]

# 가장자리 계단현상을 없애기 위한 픽셀당 표본 수(한 변 기준).
SUPERSAMPLE = 4


def point_in_polygon(x: float, y: float, polygon: list[tuple[float, float]]) -> bool:
    """짝수-홀수 규칙 레이캐스팅."""
    inside = False
    count = len(polygon)
    j = count - 1
    for i in range(count):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def render(size: int, bolt_scale: float) -> bytes:
    """size×size RGB 픽셀 데이터를 만든다.

    bolt_scale은 번개가 차지하는 비율이다. maskable 아이콘은 런처가 가장자리를
    잘라내므로(안전 영역 약 80%) 더 작게 그려야 잘리지 않는다.
    """
    offset = (1.0 - bolt_scale) / 2.0
    scaled = [(offset + px * bolt_scale, offset + py * bolt_scale) for px, py in BOLT]

    rows = bytearray()
    step = 1.0 / (size * SUPERSAMPLE)

    for py in range(size):
        rows.append(0)  # PNG 필터 타입: None
        for px in range(size):
            hits = 0
            for sy in range(SUPERSAMPLE):
                y = (py * SUPERSAMPLE + sy + 0.5) * step
                for sx in range(SUPERSAMPLE):
                    x = (px * SUPERSAMPLE + sx + 0.5) * step
                    if point_in_polygon(x, y, scaled):
                        hits += 1
            alpha = hits / (SUPERSAMPLE * SUPERSAMPLE)
            for channel in range(3):
                value = BACKGROUND[channel] * (1 - alpha) + FOREGROUND[channel] * alpha
                rows.append(round(value))

    return bytes(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    # 비트깊이 8, 컬러타입 2(RGB)
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    targets = [
        ("icon-192.png", 192, 0.72),
        ("icon-512.png", 512, 0.72),
        # maskable은 런처가 원/스퀘어클 등으로 잘라내므로 안전 영역 안에 들어가게 줄인다.
        ("icon-maskable-512.png", 512, 0.52),
    ]
    for name, size, bolt_scale in targets:
        path = OUT_DIR / name
        write_png(path, size, render(size, bolt_scale))
        print(f"생성: {path} ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
