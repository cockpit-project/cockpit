Name:           python3-cockpit
Summary:        Web Console for Linux servers

License:        GPL-3.0-or-later
URL:            https://cockpit-project.org/

Version:        0
Release:        1
Source0:        cockpit-%{version}.tar.gz

Obsoletes:      cockpit-bridge < 300
Provides:       cockpit-bridge = 300

BuildArch: noarch
BuildRequires: pyproject-rpm-macros

%generate_buildrequires
%pyproject_buildrequires

%description
Cockpit experimental python package.

%prep
%setup -n cockpit-%{version}

%build
%pyproject_wheel

%install
%pyproject_install .
%pyproject_save_files '*' +auto

%files -n python3-cockpit -f %{pyproject_files}
