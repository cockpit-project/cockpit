# Copyright (c) 2019, Mapbox, Wu Haotian
# Copyright (c) 2026, Freya Gustavsson
# SPDX-License-Identifier: ISC

from collections.abc import Collection
from typing import Optional

from .types import ImageArea, ImageSequence, MutableImageSequence, RGBTuple
from .utils import antialiased, color_delta, draw_gray_pixel, draw_pixel, ignorable_coord


def pixelmatch(
    img1: ImageSequence,
    img2: ImageSequence,
    width: int,
    height: int,
    output: Optional[MutableImageSequence] = None,
    threshold: float = 0.1,
    includeAA: bool = False,
    alpha: float = 0.1,
    aa_color: RGBTuple = (255, 255, 0),
    diff_color: RGBTuple = (255, 0, 0),
    diff_mask: bool = False,
    fail_fast: bool = False,
    masked_areas: Collection[ImageArea] = [],
    masked_areas_color: RGBTuple = (0, 255, 0)
) -> int:
    """
    Compares two images, writes the output diff and returns the number of mismatched pixels.
    'Raw image data' refers to a 1D, indexable collection of image data in the
    format [R1, G1, B1, A1, R2, G2, ...].

    :param img1: Image data to compare with img2. Must be the same size as img2
    :param img2: Image data to compare with img2. Must be the same size as img1
    :param width: Width of both images (they should be the same).
    :param height: Height of both images (they should be the same).
    :param output: Image data to write the diff to. Should be the same size as
    :param threshold: matching threshold (0 to 1); smaller is more sensitive, defaults to 1
    :param includeAA: whether or not to skip anti-aliasing detection, ie if includeAA is True,
        detecting and ignoring anti-aliased pixels is disabled. Defaults to False
    :param alpha: opacity of original image in diff output, defaults to 0.1
    :param aa_color: tuple of RGB color of anti-aliased pixels in diff output,
        defaults to (255, 255, 0) (yellow)
    :param diff_color: tuple of RGB color of the color of different pixels in diff output,
        defaults to (255, 0, 0) (red)
    :param diff_mask: whether or not to draw the diff over a transparent background (a mask),
        defaults to False
    :param fail_fast: if true, will return after first different pixel. Defaults to false
    :param masked_areas: collection of areas to ignore in (x, y, x_delta, y_delta)
    :param masked_areas_color: tuple of RGB color of masked out pixels in diff output,
        defaults to (0, 255, 0) (green)
    :return: number of pixels that are different or 1 if fail_fast == true
    """

    if len(img1) != len(img2):
        raise ValueError("Image sizes do not match.", len(img1), len(img2))
    if output and len(output) != len(img1):
        raise ValueError("Diff image size does not match img1 & img2.", len(img1), len(output))

    if len(img1) != width * height * 4:
        raise ValueError(
            "Image data size does not match width/height.",
            len(img1),
            width * height * 4,
        )

    # fast path if identical
    if img1 == img2:
        if output and not diff_mask:
            for i in range(width * height):
                draw_gray_pixel(img1, 4 * i, alpha, output)

        return 0

    # maximum acceptable square distance between two colors;
    # 35215 is the maximum possible value for the YIQ difference metric
    maxDelta = 35215 * threshold * threshold

    diff = 0
    aaR, aaG, aaB = aa_color
    diffR, diffG, diffB = diff_color
    maskR, maskG, maskB = masked_areas_color

    # compare each pixel of one image against the other one
    for y in range(height):
        for x in range(width):
            pos = (y * width + x) * 4

            # squared YUV distance between colors at this pixel position
            delta = color_delta(img1, img2, pos, pos)

            # the color difference is above the threshold
            if delta > maxDelta:
                # check it's a real rendering difference or just anti-aliasing
                if not includeAA and (
                    antialiased(img1, x, y, width, height, img2) or antialiased(img2, x, y, width, height, img1)
                ):
                    # one of the pixels is anti-aliasing; draw as yellow and do not count as difference
                    # note that we do not include such pixels in a mask
                    if output and not diff_mask:
                        draw_pixel(output, pos, aaR, aaG, aaB)
                else:

                    # ignore masked coords
                    if (
                        ignorable_coord(x, y, masked_areas)
                    ):
                        if output:
                            draw_pixel(output, pos, maskR, maskG, maskB)
                    else:
                        # found substantial difference not caused by anti-aliasing; draw it as red
                        if output:
                            draw_pixel(output, pos, diffR, diffG, diffB)
                        if fail_fast:
                            return 1
                        diff += 1

            elif output:
                # pixels are similar; draw background as grayscale image blended with white
                if not diff_mask:
                    draw_gray_pixel(img1, pos, alpha, output)

    # return the number of different pixels
    return diff
