# Copyright (c) 2019, Mapbox, Wu Haotian
# Copyright (c) 2026, Freya Gustavsson
# SPDX-License-Identifier: ISC

from collections.abc import Collection

from .types import ImageArea, ImageSequence, MutableImageSequence


def antialiased(img: ImageSequence, x1: int, y1: int, width: int, height: int, img2: ImageSequence) -> bool:
    """
    check if a pixel is likely a part of anti-aliasing;
    based on "Anti-aliased Pixel and Intensity Slope Detector" paper by V. Vysniauskas, 2009
    """
    x0 = max(x1 - 1, 0)
    y0 = max(y1 - 1, 0)
    x2 = min(x1 + 1, width - 1)
    y2 = min(y1 + 1, height - 1)
    pos = (y1 * width + x1) * 4
    zeroes = int(x1 == x0 or x1 == x2 or y1 == y0 or y1 == y2)
    min_delta = max_delta = 0.0
    min_x = min_y = max_x = max_y = 0

    # go through 8 adjacent pixels
    for x in range(x0, x2 + 1):
        for y in range(y0, y2 + 1):
            if x == x1 and y == y1:
                continue

            # brightness delta between the center pixel and adjacent one
            delta = color_delta(img, img, pos, (y * width + x) * 4, y_only=True)

            # count the number of equal, darker and brighter adjacent pixels
            if delta == 0:
                zeroes += 1
                # if found more than 2 equal siblings, it's definitely not anti-aliasing
                if zeroes > 2:
                    return False

            # remember the darkest pixel
            elif delta < min_delta:
                min_delta = delta
                min_x = x
                min_y = y

            # remember the brightest pixel
            elif delta > max_delta:
                max_delta = delta
                max_x = x
                max_y = y

    # if there are no both darker and brighter pixels among siblings, it's not anti-aliasing
    if min_delta == 0 or max_delta == 0:
        return False

    # if either the darkest or the brightest pixel has 3+ equal siblings in both images
    # (definitely not anti-aliased), this pixel is anti-aliased
    return (
        has_many_siblings(img, min_x, min_y, width, height) and has_many_siblings(img2, min_x, min_y, width, height)
    ) or (
        has_many_siblings(img, max_x, max_y, width, height) and has_many_siblings(img2, max_x, max_y, width, height)
    )


def has_many_siblings(img: ImageSequence, x1: int, y1: int, width: int, height: int) -> bool:
    """
    check if a pixel has 3+ adjacent pixels of the same color.
    """
    x0 = max(x1 - 1, 0)
    y0 = max(y1 - 1, 0)
    x2 = min(x1 + 1, width - 1)
    y2 = min(y1 + 1, height - 1)
    pos = (y1 * width + x1) * 4
    zeroes = int(x1 == x0 or x1 == x2 or y1 == y0 or y1 == y2)

    # go through 8 adjacent pixels
    for x in range(x0, x2 + 1):
        for y in range(y0, y2 + 1):
            if x == x1 and y == y1:
                continue

            pos2 = (y * width + x) * 4
            if all(img[pos + offset] == img[pos2 + offset] for offset in range(4)):
                zeroes += 1

            if zeroes > 2:
                return True

    return False


def color_delta(img1: ImageSequence, img2: ImageSequence, k: int, m: int, y_only: bool = False) -> float:
    """
    calculate color difference according to the paper "Measuring perceived color difference
    using YIQ NTSC transmission color space in mobile applications" by Y. Kotsarenko and F. Ramos
    """
    r1, g1, b1, a1 = [img1[k + offset] for offset in range(4)]
    r2, g2, b2, a2 = [img2[m + offset] for offset in range(4)]

    if a1 == a2 and r1 == r2 and g1 == g2 and b1 == b2:
        return 0.0

    if a1 < 255:
        a1 /= 255
        r1, b1, g1 = blendRGB(r1, b1, g1, a1)

    if a2 < 255:
        a2 /= 255
        r2, b2, g2 = blendRGB(r2, b2, g2, a2)

    y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2)

    if y_only:
        # brightness difference only
        return y

    i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
    q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)

    return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q


def rgb2y(r: float, g: float, b: float) -> float:
    return r * 0.29889531 + g * 0.58662247 + b * 0.11448223


def rgb2i(r: float, g: float, b: float) -> float:
    return r * 0.59597799 - g * 0.27417610 - b * 0.32180189


def rgb2q(r: float, g: float, b: float) -> float:
    return r * 0.21147017 - g * 0.52261711 + b * 0.31114694


def blendRGB(r: float, g: float, b: float, a: float):
    """
    Blend r, g, and b with a
    :param r: red channel to blend with a
    :param g: green channel to blend with a
    :param b: blue channel to blend with a
    :param a: alpha to blend with
    :return: tuple of blended r, g, b
    """
    return blend(r, a), blend(g, a), blend(b, a)


def blend(c: float, a: float) -> float:
    """blend semi-transparent color with white"""
    return 255 + (c - 255) * a


def draw_pixel(output: MutableImageSequence, pos: int, r: float, g: float, b: float) -> None:
    output[pos + 0] = int(r)
    output[pos + 1] = int(g)
    output[pos + 2] = int(b)
    output[pos + 3] = 255


def draw_gray_pixel(img: ImageSequence, i: int, alpha: float, output: MutableImageSequence) -> None:
    r = img[i + 0]
    g = img[i + 1]
    b = img[i + 2]
    val = blend(rgb2y(r, g, b), alpha * img[i + 3] / 255)
    draw_pixel(output, i, val, val, val)


def ignorable_coord(x: int, y: int, masked_areas: Collection[ImageArea]) -> bool:
    for (x0, y0, x1, y1) in masked_areas:
        if x >= x0 - 2 and x < x1 + 2 and y >= y0 - 2 and y < y1 + 2:
            return True
    return False
