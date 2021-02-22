import unittest
from pathlib import Path
from fmf_metadata.base import yaml_fmf_output, FMFError, read_config

CURRENT_DIR = Path(__file__).parent.absolute()


class TestFMF(unittest.TestCase):
    def testBasic(self):
        out = yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-basic"])
        self.assertEqual(
            out["/test-basic"]["/Test1"]["/testAdjust"]["adjust"],
            [
                {"when": "component == cockpit", "environment": {"shell": True}},
                {"when": "distro ~< centos-6", "enabled": False},
                {"when": "distro > Fedora-33", "enabled": False},
            ],
        )
        self.assertEqual(
            out["/test-basic"]["/Test1"]["/testDynamicFMFattr"]["tier"], "tier1"
        )
        self.assertEqual(
            out["/test-basic"]["/Test1"]["/testSummaryDOCstr"]["summary"],
            "Basic test of cockpit login abilities",
        )
        self.assertIn(
            "It show system page after login",
            out["/test-basic"]["/Test1"]["/testSummaryDOCstr"]["description"],
        )
        self.assertEqual(
            out["/test-basic"]["/Test1"]["/testSummaryTag"]["summary"],
            "This is nondestructive test",
        )
        self.assertEqual(
            out["/test-basic"]["/Test1"]["/testTagExtensionPost"]["tag+"],
            ["tier2", "example"],
        )
        self.assertEqual(
            out["/test-basic"]["/TestLinks"]["/testOne"]["link"],
            [{"verifies": "url://link2"}, "url://link", {"dependson": "url://link4"}],
        )
        self.assertEqual(
            out["/test-basic"]["/TestLinks"]["/testThree"]["link"],
            ["url://link3", "url://link", {"dependson": "url://link4"}],
        )
        self.assertEqual(
            out["/test-basic"]["/TestDictMerge"]["/test"]["adjust"],
            {"a": "c", "b": "d", "x": "y"},
        )

    def testBadFMFKey(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-bad-fmf-key"])
        self.assertIn("fmf decorator nonsense not found in dict_", str(ctx.exception))

    def testNoTestFile(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["non-existing-file"])
        self.assertIn("There are no test in path", str(ctx.exception))

    def testBadBaseType(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(
                path=CURRENT_DIR, testfile_globs=["test-raise-bad-base-type"]
            )
        self.assertIn(
            "type <class 'dict'> (value:{'abc': 1}) is not allowed", str(ctx.exception)
        )

    def testBadValue(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-raise-bad-value"])
        self.assertIn("type <class 'int'> (value:1) is not allowed", str(ctx.exception))

    def testBadMerging(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-raise-merging"])
        self.assertIn("you are mixing various post_marks for", str(ctx.exception))


class TestConfig(unittest.TestCase):
    def testUnit(self):
        out = yaml_fmf_output(config=read_config(CURRENT_DIR / "metadata_config.yaml"))
        data = out["/check-example.py"]["/Test1"]["/testEnvironmentConfig"]
        self.assertEqual(data["environment"]["DEBUG"], True)
        self.assertEqual(
            data["environment"]["TEST_STR"],
            "check-example.py.Test1.testEnvironmentConfig",
        )
        self.assertTrue(data["environment"]["FMF_ROOT_DIR"].endswith("tests"))
        self.assertEqual(data["deep"]["struct"]["deeper"]["neco"], "out")
        self.assertIn("check-example.py", data["deep"]["struct"]["test"])

        self.assertEqual(set(data["generic_A"]), set(["aaa"]))
        self.assertEqual(
            set(out["/check-example.py"]["/Test1"]["/testGeneric"]["generic_A"]),
            set(["a", "aa", "aaa"]),
        )
        self.assertEqual(
            set(out["/check-example.py"]["/Test1"]["/testGeneric"]["generic_B"]),
            set(["b", "bb"]),
        )
        # test merge override
        self.assertEqual(
            out["/check-example.py"]["/Test1"]["/testMerge"]["tag+"], ["t2", "t1"]
        )
