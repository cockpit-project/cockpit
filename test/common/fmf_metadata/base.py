from typing import List
import io
import inspect
import unittest
import yaml
import importlib
import os
import glob
import sys
from fmf_metadata.constants import (
    FMF_POSTFIX,
    FMF_ATTRIBUTES,
    FMF_ATTR_PREFIX,
    MAIN_FMF,
    TEST_METHOD_PREFIX,
    CONFIG_FMF_FILE,
    CONFIG_TESTGLOBS,
    CONFIG_TEST_PATH,
    CONFIG_POSTPROCESSING_TEST,
    CONFIG_ADDITIONAL_KEY,
    DESCRIPTION_KEY,
    SUMMARY_KEY,
    TEST_PATH,
    TESTFILE_GLOBS,
    CONFIG_MERGE_PLUS,
    CONFIG_MERGE_MINUS,
    ENVIRONMENT_KEY,
)

# Handle both older and newer yaml loader
# https://msg.pyyaml.org/load
try:
    from yaml import FullLoader as YamlLoader
except ImportError:  # pragma: no cover
    from yaml import SafeLoader as YamlLoader


# Load all strings from YAML files as unicode
# https://stackoverflow.com/questions/2890146/
def construct_yaml_str(self, node):
    return self.construct_scalar(node)


YamlLoader.add_constructor("tag:yaml.org,2002:str", construct_yaml_str)


def debug_print(*args, **kwargs):
    kwargs["file"] = sys.stderr
    print(*args, **kwargs)


class _Test:
    def __init__(self, test):
        self.test = test
        self.name = test._testMethodName
        self.method = getattr(test.__class__, test._testMethodName)


class _TestCls:
    def __init__(self, test_class, filename):
        self.file = filename
        self.cls = test_class
        self.name = test_class.__name__
        self.tests = []


def filepath_tests(filename) -> List[_TestCls]:
    test_loader = unittest.TestLoader()
    output = []
    loader = importlib.machinery.SourceFileLoader("non_important", filename)
    module = importlib.util.module_from_spec(
        importlib.util.spec_from_loader(loader.name, loader)
    )
    loader.exec_module(module)
    for test_suite in test_loader.loadTestsFromModule(module):
        for test in test_suite:
            cls = _TestCls(test.__class__, filename)
            if cls.name in [x for x in output if x.name == cls.name]:
                cls = [x for x in output if x.name == cls.name][0]
            else:
                output.append(cls)
            cls.tests.append(_Test(test))
    return output


def get_test_files(path, testfile_globs):
    output = list()
    for testfile_glob in testfile_globs:
        output += glob.glob(os.path.join(path, testfile_glob))
    if not output:
        raise FMFError(
            "There are no test in path {} via {}".format(path, testfile_globs)
        )
    return output


class Error(Exception):
    def __init__(self, msg):
        self.msg = msg

    def __str__(self):
        return self.msg


class FMFError(Error):
    pass


def is_test_function(member):
    return inspect.isfunction(member) and member.__name__.startswith(TEST_METHOD_PREFIX)


def __set_method_attribute(item, attribute, value, post_mark, base_type=None):
    if post_mark not in FMF_POSTFIX:
        raise FMFError("as postfix you can use + or - or let it empty (FMF merging)")
    attr_postfixed = attribute + post_mark
    for postfix in set(FMF_POSTFIX) - {post_mark}:
        if hasattr(item, attribute + postfix):
            raise FMFError(
                "you are mixing various post_marks for {} ({} already exists)".format(
                    item, attribute + postfix
                )
            )
    if base_type is None:
        if isinstance(value, list) or isinstance(value, tuple):
            base_type = (list,)
        elif isinstance(value, dict):
            base_type = dict
            value = [value]
        else:
            value = [value]

    if isinstance(base_type, tuple) and base_type[0] in [tuple, list]:
        if not hasattr(item, attr_postfixed):
            setattr(item, attr_postfixed, list())
        # check expected object types for FMF attributes
        for value_item in value:
            if len(base_type) > 1 and not isinstance(value_item, tuple(base_type[1:])):
                raise FMFError(
                    "type {} (value:{}) is not allowed, please use: {} ".format(
                        type(value_item), value_item, base_type[1:]
                    )
                )
        getattr(item, attr_postfixed).extend(list(value))
        return

    # use just first value in case you don't use list of tuple
    if len(value) > 1:
        raise FMFError(
            "It is not permitted for {} (type:{}) put multiple values ({})".format(
                attribute, base_type, value
            )
        )
    first_value = value[0]
    if base_type and not isinstance(first_value, base_type):
        raise FMFError(
            "type {} (value:{}) is not allowed, please use: {} ".format(
                type(first_value), first_value, base_type
            )
        )
    if base_type in [dict]:
        if not hasattr(item, attr_postfixed):
            setattr(item, attr_postfixed, dict())
        first_value.update(getattr(item, attr_postfixed))
    if hasattr(item, attr_postfixed) and base_type not in [dict]:
        # if it is already defined (not list types or dict) exit
        # class decorators are applied right after, does not make sense to rewrite more specific
        # dict updating is reversed
        return
    setattr(item, attr_postfixed, first_value)


def set_obj_attribute(
    testEntity,
    attribute,
    value,
    raise_text=None,
    base_class=unittest.TestCase,
    base_type=None,
    post_mark="",
):
    if inspect.isclass(testEntity) and issubclass(testEntity, base_class):
        for test_function in inspect.getmembers(testEntity, is_test_function):
            __set_method_attribute(
                test_function[1],
                attribute,
                value,
                post_mark=post_mark,
                base_type=base_type,
            )
    elif is_test_function(testEntity):
        __set_method_attribute(
            testEntity, attribute, value, base_type=base_type, post_mark=post_mark
        )
    elif raise_text:
        raise FMFError(raise_text)
    return testEntity


def generic_metadata_setter(
    attribute,
    value,
    raise_text=None,
    base_class=unittest.TestCase,
    base_type=None,
    post_mark="",
):
    def inner(testEntity):
        return set_obj_attribute(
            testEntity,
            attribute,
            value,
            raise_text,
            base_class,
            base_type=base_type,
            post_mark=post_mark,
        )

    return inner


def fmf_prefixed_name(name):
    return FMF_ATTR_PREFIX + name


class __FMFMeta(type):
    @staticmethod
    def _set_fn(name, base_type=None):
        if name not in FMF_ATTRIBUTES:
            raise FMFError(
                "fmf decorator {} not found in {}".format(name, FMF_ATTRIBUTES.keys())
            )

        def inner(*args, post_mark=""):
            return generic_metadata_setter(
                fmf_prefixed_name(name),
                args,
                base_type=base_type or FMF_ATTRIBUTES[name],
                post_mark=post_mark,
            )

        return inner

    def __getattr__(cls, name):
        return cls._set_fn(name)


class FMF(metaclass=__FMFMeta):
    """
    This class implements class decorators for TMT semantics via dynamic class methods
    see https://tmt.readthedocs.io/en/latest/spec/tests.html
    """

    @classmethod
    def tag(cls, *args, post_mark=""):
        """
        generic purpose test tags to be used (e.g. "slow", "fast", "security")
        https://tmt.readthedocs.io/en/latest/spec/tests.html#tag
        """
        return cls._set_fn("tag", base_type=FMF_ATTRIBUTES["tag"])(
            *args, post_mark=post_mark
        )

    @classmethod
    def link(cls, *args, post_mark=""):
        """
        generic url links (default is verify) but could contain more see TMT doc
        https://tmt.readthedocs.io/en/latest/spec/core.html#link
        """
        return cls._set_fn("link", base_type=FMF_ATTRIBUTES["link"])(
            *args, post_mark=post_mark
        )

    @classmethod
    def bug(cls, *args, post_mark=""):
        """
        link to relevant bugs what this test verifies.
        It can be link to issue tracker or bugzilla
        https://tmt.readthedocs.io/en/latest/spec/tests.html#link
        """
        return cls.link(*[{"verifies": arg} for arg in args], post_mark=post_mark)

    @classmethod
    def adjust(
        cls, when, because=None, continue_execution=True, post_mark="", **kwargs
    ):
        """
        adjust testcase execution, see TMT specification
        https://tmt.readthedocs.io/en/latest/spec/core.html#adjust

        if key value arguments are passed they are applied as update of the dictionary items
        else disable test execution as default option

        e.g.

        @adjust("distro ~< centos-6", "The test is not intended for less than centos-6")
        @adjust("component == bash", "modify component", component="shell")

        tricky example with passing merging variables as kwargs to code
        because python does not allow to do parameter as X+="something"
        use **dict syntax for parameter(s)

        @adjust("component == bash", "append env variable", **{"environment+": {"BASH":true}})
        """
        adjust_item = dict()
        adjust_item["when"] = when
        if because is not None:
            adjust_item["because"] = because
        if kwargs:
            adjust_item.update(kwargs)
        else:
            adjust_item["enabled"] = False
        if continue_execution is False:
            adjust_item["continue"] = False
        return cls._set_fn("adjust", base_type=FMF_ATTRIBUTES["adjust"])(
            adjust_item, post_mark=post_mark
        )

    @classmethod
    def environment(cls, post_mark="", **kwargs):
        """
        environment testcase execution, see TMT specification
        https://tmt.readthedocs.io/en/latest/spec/test.html#environment

        add environment keys
        example:
        @environment(PYTHONPATH=".", DATA_DIR="test_data")
        """
        return cls._set_fn(ENVIRONMENT_KEY, base_type=FMF_ATTRIBUTES[ENVIRONMENT_KEY])(
            kwargs, post_mark=post_mark
        )


def identifier(text):
    return "/" + text


def default_key(parent_dict, key, empty_obj):
    if key not in parent_dict:
        output = empty_obj
        parent_dict[key] = output
        return output
    return parent_dict[key]


def __update_dict_key(method, key, fmf_key, dictionary, override_postfix=""):
    """
    This function have to ensure that there is righ one of attribute type extension
    and removes all others
    """
    value = None
    current_postfix = ""
    # find if item is defined inside method
    for attribute in dir(method):
        stripped = attribute.rstrip("".join(FMF_POSTFIX))
        if key == stripped:
            value = getattr(method, attribute)
            strip_len = len(stripped)
            current_postfix = attribute[strip_len:]
    # delete all keys in dictionary started with fmf_key
    for item in dictionary.copy():
        stripped = item.rstrip("".join(FMF_POSTFIX))
        if stripped == fmf_key:
            dictionary.pop(item)
    out_key = (
        fmf_key + override_postfix if override_postfix else fmf_key + current_postfix
    )
    if value:
        dictionary[out_key] = value


def __get_fmf_attr_name(method, attribute):
    for current_attr in [fmf_prefixed_name(attribute + x) for x in FMF_POSTFIX]:
        if hasattr(method, current_attr):
            return current_attr
    return fmf_prefixed_name(attribute)


def __find_fmf_root(path):
    root = os.path.abspath(path)
    FMF_ROOT_DIR = ".fmf"
    while True:
        if os.path.exists(os.path.join(root, FMF_ROOT_DIR)):
            return root
        if root == os.path.sep:
            raise FMFError(
                "Unable to find FMF tree root for '{0}'.".format(os.path.abspath(path))
            )
        root = os.path.dirname(root)


def yaml_fmf_output(
    path=None,
    testfile_globs=None,
    fmf_file=None,
    config=None,
    merge_plus_list=None,
    merge_minus_list=None,
):
    config = config or dict()
    # set values in priority 1. input param, 2. from config file, 3. default value
    fmf_file = fmf_file or config.get(CONFIG_FMF_FILE, MAIN_FMF)
    testfile_globs = testfile_globs or config.get(CONFIG_TESTGLOBS, TESTFILE_GLOBS)
    path = os.path.realpath(path or config.get(CONFIG_TEST_PATH, TEST_PATH))
    merge_plus_list = merge_plus_list or config.get(CONFIG_MERGE_PLUS, [])
    merge_minus_list = merge_minus_list or config.get(CONFIG_MERGE_MINUS, [])
    debug_print("Use config:", config)
    debug_print("Input FMF file:", fmf_file)
    debug_print("Tests path:", path)
    debug_print("Test globs:", testfile_globs)
    fmf_dict = dict()
    if fmf_file and os.path.exists(fmf_file):
        with open(fmf_file) as fd:
            fmf_dict = yaml.load(fd, Loader=YamlLoader) or fmf_dict
    for filename in get_test_files(path, testfile_globs):
        filename_dict = default_key(
            fmf_dict, identifier(os.path.basename(filename)), {}
        )
        for cls in filepath_tests(filename):
            class_dict = default_key(filename_dict, identifier(cls.name), {})
            for test in cls.tests:
                test_dict = default_key(class_dict, identifier(test.name), {})
                doc_str = (test.method.__doc__ or "").strip("\n")
                # set summary attribute if not given by decorator
                current_name = __get_fmf_attr_name(test.method, SUMMARY_KEY)
                if not hasattr(test.method, current_name):
                    # try to use first line of docstring if given
                    if doc_str:
                        summary = doc_str.split("\n")[0].strip()
                    else:
                        summary = "{} {} {}".format(
                            os.path.basename(filename), cls.name, test.name
                        )
                    setattr(test.method, current_name, summary)

                # set description attribute by docstring if not given by decorator
                current_name = __get_fmf_attr_name(test.method, DESCRIPTION_KEY)
                if not hasattr(test.method, current_name):
                    # try to use first line of docstring if given
                    if doc_str:
                        description = doc_str
                        setattr(test.method, current_name, description)
                # generic FMF attributes set by decorators
                for key in FMF_ATTRIBUTES:
                    # Allow to override key storing with merging postfixes
                    override_postfix = ""
                    if key in merge_plus_list:
                        override_postfix = "+"
                    elif key in merge_minus_list:
                        override_postfix = "-"
                    __update_dict_key(
                        test.method,
                        fmf_prefixed_name(key),
                        key,
                        test_dict,
                        override_postfix,
                    )
                # special config items
                if CONFIG_ADDITIONAL_KEY in config:
                    for key, fmf_key in config[CONFIG_ADDITIONAL_KEY].items():
                        __update_dict_key(test.method, key, fmf_key, test_dict)
                if CONFIG_POSTPROCESSING_TEST in config:
                    # debug_print("Doing posprocessing: ", config[CONFIG_POSTPROCESSING_TEST])
                    __post_processing(
                        test_dict, config[CONFIG_POSTPROCESSING_TEST], cls, test
                    )
    return fmf_dict


def __post_processing(input_dict, config_dict, cls, test):
    if isinstance(config_dict, dict):
        for k, v in config_dict.items():
            if isinstance(v, dict):
                if k not in input_dict:
                    input_dict[k] = dict()
                __post_processing(input_dict[k], v, cls, test)
            else:
                input_dict[k] = eval(v)


def read_config(config_file):
    if not os.path.exists(config_file):
        raise FMFError(f"configuration files does not exists {config_file}")
    debug_print(f"Read config file: {config_file}")
    with open(config_file) as fd:
        return yaml.safe_load(fd)


def dict_to_yaml(data, width=None, sort=False):
    """ Convert dictionary into yaml """
    output = io.StringIO()
    try:
        yaml.safe_dump(
            data,
            output,
            sort_keys=sort,
            encoding="utf-8",
            allow_unicode=True,
            width=width,
            indent=4,
            default_flow_style=False,
        )
    except TypeError:
        # FIXME: Temporary workaround for rhel-8 to disable key sorting
        # https://stackoverflow.com/questions/31605131/
        # https://github.com/psss/tmt/issues/207
        def representer(self, data):
            self.represent_mapping("tag:yaml.org,2002:map", data.items())

        yaml.add_representer(dict, representer, Dumper=yaml.SafeDumper)
        yaml.safe_dump(
            data,
            output,
            encoding="utf-8",
            allow_unicode=True,
            width=width,
            indent=4,
            default_flow_style=False,
        )
    return output.getvalue()
