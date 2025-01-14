from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "listing"
ICON = ROOT / "assets" / "icons" / "icon128.png"


COLORS = {
    "ink": (23, 32, 38),
    "muted": (67, 81, 90),
    "panel": (249, 251, 251),
    "line": (207, 215, 220),
    "dark": (24, 50, 58),
    "teal": (22, 122, 114),
    "lime": (214, 242, 107),
    "blue": (24, 167, 213),
    "green": (44, 159, 72),
    "red": (217, 51, 79),
    "cream": (246, 251, 251),
    "board_light": (235, 238, 214),
    "board_dark": (122, 150, 91),
}


def font(size, bold=False):
    names = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
    ]
    for name in names:
        path = Path(name)
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, value, size=24, fill=None, bold=False, anchor=None):
    draw.text(xy, value, font=font(size, bold), fill=fill or COLORS["ink"], anchor=anchor)


def center_text(draw, box, value, size=24, fill=None, bold=False):
    fnt = font(size, bold)
    bbox = draw.textbbox((0, 0), value, font=fnt)
    x = box[0] + (box[2] - box[0] - (bbox[2] - bbox[0])) / 2
    y = box[1] + (box[3] - box[1] - (bbox[3] - bbox[1])) / 2 - 1
    draw.text((x, y), value, font=fnt, fill=fill or COLORS["ink"])


def draw_browser_frame(draw, width):
    draw.rectangle((0, 0, width, 58), fill=(238, 243, 245))
    draw.rectangle((0, 57, width, 58), fill=(208, 219, 224))
    for i, color in enumerate([(239, 83, 80), (251, 188, 5), (52, 168, 83)]):
        draw.ellipse((20 + i * 22, 21, 32 + i * 22, 33), fill=color)
    rounded(draw, (112, 15, width - 110, 43), 14, (255, 255, 255), (210, 220, 225))
    text(draw, (134, 22), "Completed game review", 13, COLORS["muted"])


def draw_board(draw, origin, size, flipped=False):
    x0, y0 = origin
    square = size / 8
    rounded(draw, (x0 - 12, y0 - 12, x0 + size + 12, y0 + size + 12), 10, (33, 43, 48), None)
    for rank in range(8):
        for file_index in range(8):
            fill = COLORS["board_light"] if (rank + file_index) % 2 == 0 else COLORS["board_dark"]
            x = x0 + file_index * square
            y = y0 + rank * square
            draw.rectangle((x, y, x + square + 1, y + square + 1), fill=fill)

    pieces = {
        "a8": "r", "c8": "b", "e8": "k", "g8": "r",
        "a7": "p", "b7": "p", "d7": "q", "f7": "p", "h7": "p",
        "c6": "n", "e5": "p", "g5": "n",
        "e4": "P", "c4": "B", "f3": "N", "g2": "P",
        "a2": "P", "b2": "P", "d2": "Q", "f2": "P", "h2": "P",
        "a1": "R", "c1": "B", "e1": "K", "g1": "R",
    }

    for square_name, piece in pieces.items():
        file_index = ord(square_name[0]) - ord("a")
        rank = int(square_name[1])
        col = 7 - file_index if flipped else file_index
        row = rank - 1 if flipped else 8 - rank
        cx = x0 + col * square + square / 2
        cy = y0 + row * square + square / 2
        is_white = piece.isupper()
        fill = (247, 250, 250) if is_white else (26, 35, 40)
        outline = (180, 188, 190) if is_white else (8, 12, 14)
        draw.ellipse((cx - square * 0.31, cy - square * 0.31, cx + square * 0.31, cy + square * 0.31), fill=fill, outline=outline, width=2)
        center_text(draw, (cx - square * 0.24, cy - square * 0.26, cx + square * 0.24, cy + square * 0.24), piece.upper(), int(square * 0.34), (20, 28, 33) if is_white else (246, 251, 251), True)


def draw_arrow(draw, start, end, color):
    draw.line((start[0] + 4, start[1] + 5, end[0] + 4, end[1] + 5), fill=(24, 50, 58, 90), width=12)
    draw.line((start[0], start[1], end[0], end[1]), fill=color, width=8)
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    head = [
        (end[0], end[1]),
        (end[0] - ux * 34 + px * 15, end[1] - uy * 34 + py * 15),
        (end[0] - ux * 34 - px * 15, end[1] - uy * 34 - py * 15),
    ]
    draw.polygon(head, fill=color)


def draw_panel(draw, x, y, w=360, h=590, progress=0.72):
    rounded(draw, (x, y, x + w, y + h), 8, COLORS["panel"], COLORS["line"], 1)
    rounded(draw, (x, y, x + w, y + 54), 8, COLORS["dark"])
    draw.rectangle((x, y + 46, x + w, y + 54), fill=COLORS["dark"])
    text(draw, (x + 16, y + 17), "Post-Game Chess Coach", 16, COLORS["cream"], True)
    rounded(draw, (x + w - 72, y + 16, x + w - 18, y + 38), 11, COLORS["lime"])
    center_text(draw, (x + w - 72, y + 15, x + w - 18, y + 38), "Local", 11, (31, 42, 18), True)

    y2 = y + 72
    rounded(draw, (x + 16, y2, x + 112, y2 + 34), 6, COLORS["teal"], COLORS["teal"])
    center_text(draw, (x + 16, y2, x + 112, y2 + 34), "Analyze", 13, (255, 255, 255), True)
    rounded(draw, (x + 122, y2, x + 196, y2 + 34), 6, (255, 255, 255), (155, 176, 184))
    center_text(draw, (x + 122, y2, x + 196, y2 + 34), "Stop", 13, COLORS["ink"], True)

    text(draw, (x + 16, y2 + 54), "Analyzed 31 of 43 moves.", 13, COLORS["muted"])
    rounded(draw, (x + 16, y2 + 80, x + w - 16, y2 + 90), 5, (229, 236, 239))
    rounded(draw, (x + 16, y2 + 80, x + 16 + int((w - 32) * progress), y2 + 90), 5, COLORS["teal"])

    grades = [("Best", 8, COLORS["green"]), ("Excellent", 12, (101, 173, 67)), ("Good", 9, (145, 160, 87)), ("Mistake", 3, (229, 111, 44))]
    gx, gy = x + 16, y2 + 112
    for index, (label, count, color) in enumerate(grades):
        bx = gx + (index % 2) * 166
        by = gy + (index // 2) * 40
        rounded(draw, (bx, by, bx + 154, by + 30), 6, (255, 255, 255), (217, 225, 229))
        draw.ellipse((bx + 8, by + 6, bx + 26, by + 24), fill=color)
        text(draw, (bx + 34, by + 8), label, 11, COLORS["ink"], True)
        text(draw, (bx + 130, by + 8), str(count), 11, COLORS["muted"], True)

    table_x, table_y = x + 16, gy + 92
    rounded(draw, (table_x, table_y, x + w - 16, y + h - 20), 6, (255, 255, 255), (217, 225, 229))
    draw.rectangle((table_x + 1, table_y + 1, x + w - 17, table_y + 35), fill=(238, 244, 244))
    text(draw, (table_x + 12, table_y + 12), "Move", 10, COLORS["muted"], True)
    text(draw, (table_x + 94, table_y + 12), "Grade", 10, COLORS["muted"], True)
    text(draw, (table_x + 190, table_y + 12), "Best line", 10, COLORS["muted"], True)

    rows = [
        ("14.", "Best", "Nf3", COLORS["green"]),
        ("14...", "Good", "Qe7", (145, 160, 87)),
        ("15.", "Mistake", "Bxf7+", (229, 111, 44)),
        ("15...", "Blunder", "Kxf7", COLORS["red"]),
        ("16.", "Excellent", "Qb3+", (101, 173, 67)),
    ]
    for i, (move, grade, best, color) in enumerate(rows):
        row_y = table_y + 36 + i * 44
        if i == 3:
            draw.rectangle((table_x + 1, row_y, x + w - 17, row_y + 43), fill=(238, 250, 246))
        draw.line((table_x, row_y, x + w - 16, row_y), fill=(237, 241, 243), width=1)
        text(draw, (table_x + 12, row_y + 13), move, 13, COLORS["ink"], True)
        rounded(draw, (table_x + 84, row_y + 10, table_x + 164, row_y + 32), 11, (245, 247, 238))
        draw.ellipse((table_x + 89, row_y + 12, table_x + 107, row_y + 30), fill=color)
        text(draw, (table_x + 113, row_y + 14), grade, 10, COLORS["ink"], True)
        text(draw, (table_x + 188, row_y + 9), best, 13, COLORS["ink"])
        text(draw, (table_x + 188, row_y + 25), "local Stockfish line", 10, COLORS["muted"])


def screenshot_analysis_panel():
    image = Image.new("RGB", (1280, 800), (238, 244, 241))
    draw = ImageDraw.Draw(image)
    draw_browser_frame(draw, 1280)
    draw_board(draw, (76, 112), 600)
    draw_arrow(draw, (376, 488), (526, 338), (35, 199, 111))
    rounded(draw, (496, 300, 570, 374), 5, (35, 199, 111, 55), (35, 199, 111), 4)
    rounded(draw, (534, 306, 566, 338), 16, COLORS["red"])
    center_text(draw, (534, 305, 566, 338), "??", 12, (255, 255, 255), True)
    draw_panel(draw, 820, 96, 360, 590)
    return image


def screenshot_board_overlay():
    image = Image.new("RGB", (1280, 800), (241, 245, 243))
    draw = ImageDraw.Draw(image)
    draw_browser_frame(draw, 1280)
    draw_board(draw, (112, 94), 652)
    draw_arrow(draw, (438, 583), (601, 420), (35, 199, 111))
    rounded(draw, (560, 392, 642, 474), 6, (35, 199, 111, 60), (35, 199, 111), 5)
    rounded(draw, (620, 402, 666, 448), 23, COLORS["green"])
    center_text(draw, (620, 400, 666, 448), "!", 22, (255, 255, 255), True)
    rounded(draw, (678, 376, 800, 407), 5, COLORS["dark"])
    text(draw, (690, 384), "Best: Nf3", 14, (255, 255, 255), True)
    draw_panel(draw, 850, 112, 360, 570, 1.0)
    return image


def small_promo_tile():
    image = Image.new("RGB", (440, 280), COLORS["dark"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 440, 280), fill=(24, 50, 58))
    for i in range(12):
        color = (29, 70, 78) if i % 2 else (27, 60, 68)
        draw.rectangle((i * 44 - 20, 0, i * 44 + 24, 280), fill=color)
    draw_board(draw, (34, 46), 188)
    icon = Image.open(ICON).convert("RGBA").resize((96, 96), Image.Resampling.LANCZOS)
    image.paste(icon, (270, 42), icon)
    text(draw, (238, 158), "Post-Game", 24, COLORS["cream"], True)
    text(draw, (238, 188), "Chess Coach", 24, COLORS["lime"], True)
    text(draw, (238, 224), "Local analysis", 15, (210, 226, 230), False)
    return image


def marquee_promo_tile():
    image = Image.new("RGB", (1400, 560), COLORS["dark"])
    draw = ImageDraw.Draw(image)
    for i in range(18):
        color = (27, 67, 75) if i % 2 else (24, 56, 64)
        draw.rectangle((i * 90 - 30, 0, i * 90 + 40, 560), fill=color)
    draw_board(draw, (72, 72), 416)
    draw_arrow(draw, (280, 384), (384, 280), (35, 199, 111))
    icon = Image.open(ICON).convert("RGBA").resize((148, 148), Image.Resampling.LANCZOS)
    image.paste(icon, (732, 100), icon)
    text(draw, (720, 282), "Post-Game Chess Coach", 56, COLORS["cream"], True)
    text(draw, (724, 354), "Local move grading for completed games", 28, COLORS["lime"], False)
    rounded(draw, (724, 420, 940, 468), 24, COLORS["teal"])
    center_text(draw, (724, 420, 940, 468), "Stockfish runs locally", 20, (255, 255, 255), True)
    rounded(draw, (960, 420, 1128, 468), 24, (255, 255, 255))
    center_text(draw, (960, 420, 1128, 468), "No tracking", 20, COLORS["ink"], True)
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = {
        "screenshot-analysis-panel.png": screenshot_analysis_panel(),
        "screenshot-board-overlay.png": screenshot_board_overlay(),
        "small-promo-tile.png": small_promo_tile(),
        "marquee-promo-tile.png": marquee_promo_tile(),
    }
    for name, image in outputs.items():
        path = OUT / name
        image.save(path, optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
