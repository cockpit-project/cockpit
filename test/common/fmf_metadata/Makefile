TESTS_TARGET := ./tests/test.py

check:
	PYTHONPATH=$(CURDIR)/..:$(CURDIR) PYTHONDONTWRITEBYTECODE=1 python3 -m pytest --verbose --showlocals $(TESTS_TARGET)
