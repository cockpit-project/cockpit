# Backwards compatibility shim.  This will go away soon.

from lib.directories import get_images_data_dir

__all__ = (get_images_data_dir,)

import warnings
warnings.warn('machine_core.directories is deprecated.  Use lib.directories', DeprecationWarning)
