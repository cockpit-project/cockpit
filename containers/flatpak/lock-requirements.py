#!/usr/bin/python3
"""Resolve dependencies to pure-Python wheels and write a pinned requirements.txt.

Reads dependencies from pyproject.toml and produces a requirements.txt with
exact versions, download URLs, and sha256 hashes.
"""

import json
import logging
import subprocess
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).parent


def format_requirement(item: Mapping[str, Any]) -> str:
    name = item["metadata"]["name"]
    url = item["download_info"]["url"].split("#")[0]
    sha256 = item["download_info"]["archive_info"]["hashes"]["sha256"]
    logger.info("  %s @ %s", name, url)
    return f"{name} @ {url} \\\n    --hash=sha256:{sha256}"


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    pyproject = SCRIPT_DIR / "../../pyproject.toml"
    requirements_txt = SCRIPT_DIR / "requirements.txt"

    deps = tomllib.loads(pyproject.read_text())["project"]["dependencies"]
    logger.info("Resolving %r from %r", deps, str(pyproject))

    report = json.loads(subprocess.check_output([
        "pip", "install",
        "--dry-run", "--report=-", "--quiet", "--force",
        "--only-binary=:all:", "--platform=py3-linux-any",
        *deps,
    ]))

    lines = sorted(format_requirement(item) for item in report["install"])
    requirements_txt.write_text("\n".join(lines) + "\n")
    logger.info("Wrote %r", str(requirements_txt))


if __name__ == "__main__":
    main()
