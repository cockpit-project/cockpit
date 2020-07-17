import importlib
import glob
import os
from inspect import isclass

"""
This wrapper allows to run cockpit tests via pytest e.g.
    MACHINE=127.0.0.2:2201 BROWSER=127.0.0.2:9091 TRACE=yes \
    PYTHONPATH=test/common/:test/verify/:bots/machine/ pytest -v \
    test/verify/pytest_dynamic_loader.py::TestLogin
"""

tests_path = os.path.abspath(os.path.realpath(os.getenv("TEST_PATH", os.path.dirname(__file__))))
testfile_glob = "check-*"

for filename in glob.glob(os.path.join(tests_path, testfile_glob)):
    print(filename)
    loader = importlib.machinery.SourceFileLoader("non_important", filename)
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
    loader.exec_module(module)
    for attribute_name in dir(module):
        attribute = getattr(module, attribute_name)
        if isclass(attribute):
            globals()[attribute_name] = attribute
