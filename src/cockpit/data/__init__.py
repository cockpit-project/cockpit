try:
    import importlib.resources

    def read_cockpit_data_file(filename: str) -> bytes:
        return (importlib.resources.files('cockpit.data') / filename).read_bytes()

except ImportError:
    # Python 3.6
    import importlib.abc

    def read_cockpit_data_file(filename: str) -> bytes:
        # https://github.com/python/mypy/issues/4182
        loader = __loader__  # type: ignore[name-defined]
        assert isinstance(loader, importlib.abc.ResourceLoader)

        path = __file__.replace('__init__.py', filename)
        return loader.get_data(path)
