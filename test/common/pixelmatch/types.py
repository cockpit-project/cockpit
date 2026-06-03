# Copyright (c) 2019, Mapbox, Wu Haotian
# Copyright (c) 2026, Freya Gustavsson
# SPDX-License-Identifier: ISC

from typing import MutableSequence, Sequence, Tuple, Union

# note: this shouldn't be necessary, but apparently is
Number = Union[int, float]
ImageSequence = Sequence[Number]
MutableImageSequence = MutableSequence[Number]
RGBTuple = Union[Tuple[Number, Number, Number], Sequence[Number]]
ImageArea = Tuple[Number, Number, Number, Number]
