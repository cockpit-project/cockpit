import os
import fmf_metadata

"""
This wrapper allows to run cockpit tests via pytest e.g.
    MACHINE=127.0.0.2:2201 BROWSER=127.0.0.2:9091 TRACE=yes \
    PYTHONPATH=test/common/:test/verify/:bots/machine/ pytest -v \
    test/verify/pytest_dynamic_loader.py::TestLogin
"""


tests_path = os.path.realpath(os.getenv("TEST_PATH", os.path.dirname(__file__)))


def import_classes(path, testfile_globs):
    for filename in fmf_metadata.get_test_files(path, testfile_globs):
        for class_name, cls_dict in fmf_metadata.filepath_tests(filename).items():
            globals()[class_name] = cls_dict["class"]


import_classes(path=tests_path, testfile_globs=fmf_metadata.TESTFILE_GLOBS)
