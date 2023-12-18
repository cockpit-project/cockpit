from testinsp.base import TestInspector
from testinsp.constants import PLAIN


class ListEtcDir(TestInspector):
    store_type = PLAIN
    dir_name = "/etc"

    def get_data(self):
        return self._get_dir_list_with_size(self.dir_name)
