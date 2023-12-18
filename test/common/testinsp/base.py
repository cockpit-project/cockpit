import os
from pathlib import Path
from json import loads, JSONDecodeError, dumps
from yaml import safe_load, YAMLError, safe_dump
from subprocess import check_output
from json import loads

from testinsp.utils import FirstRunError, Comparator
from testinsp.constants import YAML, PLAIN, JSON, STORE_PATH


class TestInspector:
    store_type = None

    def __init__(self, filename=None, pathname=STORE_PATH, external_executor=None):
        self.data = None
        self.exclude_list = list()
        class_name = self.__class__.__name__
        self.module_name = filename or class_name
        self._default_filename = f"{class_name}.data"
        os.makedirs(pathname, exist_ok=True)
        if filename is None:
            filename = self._default_filename
        self.storage_file = Path(pathname) / filename
        self.external_executor = external_executor

    def get_data(self):
        raise NotImplementedError()

    def init(self):
        self.data = self.get_data()
        self._store()

    def load(self):
        self._load_explicit()

    def store(self):
        self.data = self.get_data()
        self._store()

    def check(self):
        comp = Comparator(self.module_name, self.exclude_list)
        result_list = comp.compare(self.data, self.get_data())
        return result_list

    def run(self, command, shell=True, *args, **kwargs):
        if not self.external_executor:
            return self._run(command, shell, *args, **kwargs)
        else:
            return self.external_executor(command, *args, **kwargs)

    @staticmethod
    def _run(command, shell=True, *args, **kwargs):
        return check_output(command, *args, shell=shell, **kwargs).decode()

    def _get_json_from_process(self, command, *args, **kwargs):
        return loads(self.run(command, *args, **kwargs))

    def _get_yaml_from_process(self, command, *args, **kwargs):
        return safe_load(self.run(command, *args, **kwargs))

    def _get_dir_list_with_size(self, directory):
        output = self.run(
            f"""find {directory} -type f -printf "%p %s\\n" 2>/dev/null | sort || true"""
        )
        return output

    def _load_guess(self):
        with open(self.storage_file, "w") as fd:
            data_read = fd.read()
        try:
            self.data = loads(data_read)
            self.store_type = JSON
        except JSONDecodeError:
            try:
                self.data = safe_load(data_read)
                self.store_type = YAML
            except YAMLError:
                self.data = data_read
                self.store_type = PLAIN

    def _load_explicit(self):
        try:
            with open(self.storage_file, "r") as fd:
                data = fd.read()
        except FileNotFoundError:
            raise FirstRunError()
        if self.store_type == JSON:
            self.data = loads(data)
        elif self.store_type == YAML:
            self.data = safe_load(data)
        elif self.store_type == PLAIN:
            self.data = data

    def _store(self):
        with open(self.storage_file, "w") as fd:
            if self.store_type == JSON:
                data = dumps(self.data)
            elif self.store_type == YAML:
                data = safe_dump(self.data)
            elif self.store_type == PLAIN:
                data = self.data
            fd.write(data)
