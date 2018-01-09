#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2017 Slavek Kabrda
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

# Here we used Normalized Compression distance to look for similarities
# between log files. This allows us to take arbitrary logs and see how
# similar they are.
#
# TODO: Works very well, but is slow. Could use something  better than zlib

import zlib

import numpy

__all__ = [ "calculate", "prepare", "metric" ]

def K(val):
    result = len(zlib.compress(val.encode('utf-8'), 6))
    return float(result)

# We use a cache to accelelerate NCD calculations and avoid
# same of the re-compression of identical data
cache = { }
vectors = [ ]

def calculate(a, b):
    # Zero distance between identical pairs
    if a == b:
        return 0
    # Compression length for individual parts are cached
    Ka = cache.get(a)
    if Ka is None:
        Ka = K(a)
    Kb = cache.get(b)
    if Kb is None:
        Kb = K(b)
    # The compression distance for combined
    Kab = K(a + b)
    return (Kab - min(Ka, Kb)) / max(Ka, Kb)

# Precompute all individual hashes to cache and convert to vector array
def prepare(values):
    values = list(values)
    array = numpy.zeros((len(values), 1))
    for i, value in enumerate(values):
        index = len(vectors)
        array[i][0] = index
        vectors.append(value)
        cache[value] = K(value)
    return array

# A function usable as a metric in scikit-learn
# Make sure to call prepare() first on the actual values
def metric(x, y, values=vectors):
    i, j = int(x[0]), int(y[0])
    return calculate(values[i], values[j])
