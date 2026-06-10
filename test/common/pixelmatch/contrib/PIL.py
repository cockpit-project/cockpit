# Copyright (c) 2019, Mapbox, Wu Haotian
# Copyright (c) 2026, Freya Gustavsson
# SPDX-License-Identifier: ISC
"""Functions to facilitate direct comparison of PIL.Image instances"""

from collections.abc import Collection
from typing import Optional

import PIL.Image
from PIL.Image import Image

from pixelmatch import core
from pixelmatch.types import ImageArea, RGBTuple


def pixelmatch(
    img1: Image,
    img2: Image,
    output: Optional[Image] = None,
    threshold: float = 0.1,
    includeAA: bool = False,
    alpha: float = 0.1,
    aa_color: RGBTuple = (255, 255, 0),
    diff_color: RGBTuple = (255, 0, 0),
    diff_mask: bool = False,
    fail_fast: bool = False,
    masked_areas: Collection[ImageArea] = [],
    masked_areas_color: RGBTuple = (0, 255, 0),
) -> int:
    """
    Compares two images, writes the output diff and returns the number of mismatched pixels.
    Serves the same purpose as pixelmatch.pixelmatch, but takes PIL.Images as input instead
    of raw image data.

    :param img1: PIL.Image data to compare with img2. Must be the same size as img2
    :param img2: PIL.Image data to compare with img1. Must be the same size as img1
    :param output: RGBA Image to write the diff to. Must be the same size as img1
    :param threshold: matching threshold (0 to 1); smaller is more sensitive, defaults to 0.1
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
    width, height = img1.size
    img1_rgba = img1.convert("RGBA")
    img2_rgba = img2.convert("RGBA")
    img1_bytes = img1_rgba.tobytes()
    img2_bytes = img2_rgba.tobytes()

    # Fast path: byte-identical images have no diff
    if img1_bytes == img2_bytes:
        if output is not None and not diff_mask:
            _draw_grayscale(img1_rgba, alpha, output)
        return 0

    # core.pixelmatch doesn't read output_data, so initialize with zeros;
    # img1 should be the same size as output (and will error in .frombytes otherwise)
    output_data = bytearray(len(img1_bytes)) if output is not None else None

    diff_pixels = core.pixelmatch(
        list(img1_bytes),
        list(img2_bytes),
        width,
        height,
        # bytearray is MutableSequence[int], not MutableSequence[int | float];
        # safe because draw_pixel() only ever writes int values
        output_data,  # type: ignore[arg-type]
        threshold=threshold,
        includeAA=includeAA,
        alpha=alpha,
        aa_color=aa_color,
        diff_color=diff_color,
        diff_mask=diff_mask,
        fail_fast=fail_fast,
        masked_areas=masked_areas,
        masked_areas_color=masked_areas_color,
    )

    if output_data is not None and output is not None:
        output.frombytes(bytes(output_data), "raw", "RGBA")

    return diff_pixels


def _draw_grayscale(img_rgba: Image, alpha: float, output: Image) -> None:
    """Draw a grayscale version of img_rgba blended with white into output."""
    luminance = img_rgba.convert("L")
    # Opaque pixels get weight `alpha`, transparent pixels get 0.
    blend_weight = img_rgba.getchannel("A").point(lambda x: int(x * alpha))
    white = PIL.Image.new("L", img_rgba.size, 255)
    # Where mask is high, show luminance; where low, show white.
    blended = PIL.Image.composite(image1=luminance, image2=white, mask=blend_weight)
    output.paste(PIL.Image.merge("RGBA", (blended, blended, blended, white)))
