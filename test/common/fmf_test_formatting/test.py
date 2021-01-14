import unittest
from pathlib import Path
from fmf_metadata import yaml_fmf_output, FMFError

CURRENT_DIR = Path(__file__).parent.absolute()


class TestFMF(unittest.TestCase):
    def testBasic(self):
        out = yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-basic"])
        self.assertEqual(out["/test-basic"]["/Test1"]["/testAdjust"]["adjust"], [{'when': 'distro ~< centos-6', 'enabled': False}, {'when': 'distro > Fedora-33', 'enabled': True}])
        self.assertEqual(out["/test-basic"]["/Test1"]["/testDynamicFMFattr"]["tier"], "tier1")
        self.assertEqual(out["/test-basic"]["/Test1"]["/testNonDestructiveKW"]["non_destructive"], True)
        self.assertEqual(out["/test-basic"]["/Test1"]["/testSummaryDOCstr"]["summary"], "Basic test of cockpit login abilities")
        self.assertIn("It show system page after login", out["/test-basic"]["/Test1"]["/testSummaryDOCstr"]["description"])
        self.assertEqual(out["/test-basic"]["/Test1"]["/testSummaryTag"]["summary"], "This is nondestructive test")
        self.assertEqual(out["/test-basic"]["/Test1"]["/testTagExtensionPost"]["tag+"], ['tier2', 'example'])
        self.assertEqual(out["/test-basic"]["/TestLinks"]["/testOne"]["link"], [{'verify': 'url://link2'}, 'url://link', {'dependson': 'url://link4'}])
        self.assertEqual(out["/test-basic"]["/TestLinks"]["/testThree"]["link"], ['url://link3', 'url://link', {'dependson': 'url://link4'}])
        self.assertEqual(out["/test-basic"]["/TestDictMerge"]["/test"]["adjust"], {'a': 'c', 'b': 'd', 'x': 'y'})

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
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-raise-bad-base-type"])
        self.assertIn("type <class 'dict'> (value:{'abc': 1}) is not allowed", str(ctx.exception))

    def testBadValue(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-raise-bad-value"])
        self.assertIn("type <class 'int'> (value:1) is not allowed", str(ctx.exception))

    def testBadMerging(self):
        with self.assertRaises(FMFError) as ctx:
            yaml_fmf_output(path=CURRENT_DIR, testfile_globs=["test-raise-merging"])
        self.assertIn("you are mixing various post_marks for", str(ctx.exception))
