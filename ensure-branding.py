#!/usr/bin/env python3
import os
import sys

# --- Configuration Constants ---
OS_RELEASE_FILE = "/etc/os-release"
BRANDING_BASE_DIR = os.path.join("src", "branding")
MAKEFILE_PATH = "Makefile.am"  # Path relative to the root where this script runs

def get_distro_id():
    """Reads the current Linux distribution ID from /etc/os-release."""
    try:
        with open(OS_RELEASE_FILE, "r") as f:
            for line in f:
                if line.startswith("ID="):
                    # Extract the ID, removing quotes and whitespace
                    return line.strip().split("=")[1].strip('"').lower()
    except FileNotFoundError:
        print(f"Warning: '{OS_RELEASE_FILE}' not found. Defaulting to 'unknown'.", file=sys.stderr)
    return "unknown"

def generate_css(target_dir):
    """Generates a standard PatternFly v6 branding.css file."""
    css_path = os.path.join(target_dir, "branding.css")
    css_content = """/* SPDX-License-Identifier: LGPL-2.1-or-later */

#badge {
    inline-size: 279px;
    block-size: 80px;
    background-image: url("logo.png");
    background-size: contain;
    background-repeat: no-repeat;
}

.pf-v6-theme-dark #badge {
    background-image: url("logo-dark.png");
}

#brand::before {
    content: "${NAME}";
}

.anaconda {
    /* Brand palette */
    --brand-default-light: #79db32;
    --brand-default: #db3279;
    --brand-default-dark: #e59728;
}

.anaconda .logo {
    background-image: url("logo.png");
}

:not(.pf-v6-theme-dark) .anaconda {
    --pf-t--global--color--brand--default: var(--brand-default);
    --pf-t--global--color--brand--hover: var(--brand-default-dark);
}

.pf-v6-theme-dark .anaconda {
    --pf-t--global--color--brand--default: var(--brand-default-light);
    --pf-t--global--color--brand--hover: var(--brand-default);
}
"""
    with open(css_path, "w") as f:
        f.write(css_content)

def update_makefile(distro_id):
    """Injects the build rules into Makefile.am if they don't exist."""
    if not os.path.exists(MAKEFILE_PATH):
        print(f"Warning: '{MAKEFILE_PATH}' not found. Skipping Makefile update.", file=sys.stderr)
        return

    # Check if the distro is already configured to prevent duplicate entries
    with open(MAKEFILE_PATH, "r") as f:
        content = f.read()
        if f"{distro_id}brandingdir" in content:
            return

    # Using actual tabs (\t) as required by Makefiles
    block = f"""
# --- Auto-generated branding for {distro_id} ---
{distro_id}brandingdir = $(datadir)/cockpit/branding/{distro_id}

dist_{distro_id}branding_DATA = \\
\tsrc/branding/{distro_id}/branding.css \\
\t$(NULL)

install-data-hook::
\tln -sTfr $(DESTDIR)/usr/share/pixmaps/system-logo-white.png $(DESTDIR)$({distro_id}brandingdir)/logo.png
\tln -sTfr $(DESTDIR)/usr/share/pixmaps/{distro_id}-logo-sprite.png $(DESTDIR)$({distro_id}brandingdir)/apple-touch-icon.png
\tln -sTfr $(DESTDIR)/etc/favicon.png $(DESTDIR)$({distro_id}brandingdir)/favicon.ico
"""
    # Append the configuration to the Makefile
    with open(MAKEFILE_PATH, "a") as f:
        f.write(block)
    print(f"🔗 Configured Makefile.am for '{distro_id}'.")

def main():
    distro_id = get_distro_id()
    
    if distro_id == "unknown":
        print("Cannot determine the distribution ID. Exiting.", file=sys.stderr)
        sys.exit(1)

    distro_dir = os.path.join(BRANDING_BASE_DIR, distro_id)

    # CASE 1: The current distribution is already supported
    if os.path.exists(distro_dir):
        print(f"Branding for '{distro_id}' already exists. No action needed.")
        sys.exit(0)

    # CASE 2: The distribution is missing, generate everything dynamically
    print(f"Branding for '{distro_id}' not found. Generating dynamically...")
    try:
        os.makedirs(distro_dir, exist_ok=True)
        generate_css(distro_dir)
        print(f"Created directory and branding.css in: {distro_dir}")
        
        update_makefile(distro_id)
        
        print(f"Fully integrated '{distro_id}' branding successfully!")
    except Exception as e:
        print(f"Error during dynamic generation: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
