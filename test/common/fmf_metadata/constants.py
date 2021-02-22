import os

TEST_PATH = os.path.realpath(os.getenv("TEST_PATH", "."))

TESTFILE_GLOBS = ["test-*"]
MAIN_FMF = "main.fmf"
SUMMARY_KEY = "summary"
DESCRIPTION_KEY = "description"
ENVIRONMENT_KEY = "environment"
TEST_METHOD_PREFIX = "test"
FMF_ATTRIBUTES = {
    SUMMARY_KEY: str,
    DESCRIPTION_KEY: str,
    "order": int,
    "adjust": (
        list,
        dict,
    ),
    "tag": (
        list,
        str,
    ),
    "link": (list, str, dict),
    "duration": str,
    "tier": str,
    "component": (
        list,
        str,
    ),
    "require": (
        list,
        str,
        dict,
    ),
    "test": (str,),
    "framework": (str,),
    ENVIRONMENT_KEY: (
        dict,
        str,
    ),
    "path": (str,),
}
FMF_ATTR_PREFIX = "_fmf__"
FMF_POSTFIX = ("+", "-", "")

CONFIG_ADDITIONAL_KEY = "additional_keys"
CONFIG_POSTPROCESSING_TEST = "test_postprocessing"
CONFIG_TESTGLOBS = "test_glob"
CONFIG_TEST_PATH = "test_path"
CONFIG_FMF_FILE = "fmf_file"
CONFIG_MERGE_PLUS = "merge_plus"
CONFIG_MERGE_MINUS = "merge_minus"
