import importlib.machinery
import importlib.util
from pathlib import Path
from typing import Optional

import pytest


@pytest.hookimpl
def pytest_collect_file(file_path: Path, parent: pytest.Collector) -> Optional[pytest.Collector]:
    """Support for loading our check-* scripts as if they were modules"""
    if file_path.name.startswith('check-'):
        # Pretend that test/verify/check-name is called like test.verify.check_name
        modname = 'test.verify.' + file_path.name.replace('-', '_')
        loader = importlib.machinery.SourceFileLoader(modname, str(file_path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)

        # Return the tree node with our module pre-loaded inside of it
        collector = pytest.Module.from_parent(parent, path=file_path)
        collector._obj = module
        return collector

    return None
