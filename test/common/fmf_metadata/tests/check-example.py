#!/usr/bin/python
import unittest

from fmf_metadata import FMF
from fmf_metadata.base import generic_metadata_setter


@generic_metadata_setter(
    "_generic_b",
    ["b", "bb"],
    base_type=(
        list,
        str,
    ),
)
@generic_metadata_setter(
    "_generic_a",
    ["aaa"],
    base_type=(
        list,
        str,
    ),
)
@FMF.tag("t1")
class Test1(unittest.TestCase):
    @FMF.environment(DEBUG=True)
    def testEnvironmentConfig(self):
        pass

    @generic_metadata_setter(
        "_generic_a",
        ["a", "aa"],
        base_type=(
            list,
            str,
        ),
    )
    def testGeneric(self):
        pass

    @FMF.tag("t2")
    def testMerge(self):
        pass
