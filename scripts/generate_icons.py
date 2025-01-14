from pathlib import Path
from math import cos, pi, sin

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"
SIZES = [16, 32, 48, 128]
SCALE = 4


def star_points(cx, cy, outer, inner, points=4, rotation=-pi / 2):
    result = []
    for index in range(points * 2):
        radius = outer if index % 2 == 0 else inner
        angle = rotation + index * pi / points
        result.append((cx + cos(angle) * radius, cy + sin(angle) * radius))
    return result


def draw_icon(size):
    canvas_size = size * SCALE
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    s = canvas_size / 128

    def xy(values):
        return tuple(round(value * s) for value in values)

    # Dark extension tile.
    draw.rounded_rectangle(xy((9, 9, 119, 119)), radius=round(25 * s), fill=(22, 42, 50, 255))
    draw.rounded_rectangle(xy((15, 15, 113, 113)), radius=round(21 * s), fill=(27, 70, 78, 255))

    # A simple move-quality badge: original artwork inspired by chess annotation
    # marks, not a copy of any site's exact review icon.
    draw.ellipse(xy((28, 29, 104, 105)), fill=(9, 92, 124, 130))
    draw.ellipse(xy((22, 20, 100, 98)), fill=(31, 176, 216, 255))
    draw.ellipse(xy((29, 27, 93, 91)), fill=(102, 220, 242, 255))
    draw.arc(xy((30, 28, 94, 92)), 205, 340, fill=(255, 255, 255, 125), width=max(1, round(4 * s)))

    # Draw "!!" as geometry so it remains crisp without depending on fonts.
    for x in (46, 65):
        draw.rounded_rectangle(xy((x, 37, x + 10, 69)), radius=round(5 * s), fill=(255, 255, 255, 255))
        draw.ellipse(xy((x, 76, x + 10, 86)), fill=(255, 255, 255, 255))

    # Small sparkle for "brilliant".
    draw.polygon(star_points(94 * s, 33 * s, 17 * s, 6 * s), fill=(214, 242, 107, 255))
    draw.polygon(star_points(94 * s, 33 * s, 8 * s, 3 * s), fill=(255, 255, 255, 245))

    # Border keeps it legible on light and dark Chrome themes.
    draw.rounded_rectangle(
        xy((9, 9, 119, 119)),
        radius=round(25 * s),
        outline=(246, 251, 251, 150),
        width=max(1, round(3 * s)),
    )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        icon = draw_icon(size)
        icon.save(OUT / f"icon{size}.png")
        print(f"wrote {OUT / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
