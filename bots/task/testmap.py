# This file is part of Cockpit.
#
# Copyright (C) 2019 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

REPO_BRANCH_CONTEXT = {
    'cockpit-project/cockpit': {
        'master': ['avocado/fedora', 'container/bastion',
            'selenium/firefox', 'selenium/chrome', 'selenium/edge',
            'verify/debian-stable', 'verify/debian-testing',
            'verify/ubuntu-1804', 'verify/ubuntu-stable',
            'verify/fedora-30', 'verify/fedora-atomic',
            'verify/rhel-8-0-distropkg', 'verify/rhel-8-1',
        ],
        'rhel-7.6': ['avocado/fedora', 'container/kubernetes', 'container/bastion',
            'selenium/firefox', 'selenium/chrome', 'verify/rhel-7-6',
        ],
        'rhel-7.7': ['avocado/fedora', 'container/kubernetes', 'container/bastion',
            'selenium/firefox', 'selenium/chrome', 'verify/rhel-7-7',
        ],
        'rhel-8.0': ['avocado/fedora', 'container/bastion', 'selenium/firefox', 'selenium/chrome',
            'verify/rhel-8-0',
        ],
        'rhel-8-appstream': ['avocado/fedora', 'container/bastion', 'selenium/firefox',
            'selenium/chrome', 'verify/rhel-8-0-distropkg', 'verify/rhel-8-1',
        ],
        'rhel-8.1': ['verify/rhel-8-1',
        ],
        # These can be triggered manually with bots/tests-trigger
        '_manual': ['verify/fedora-i386', 'verify/fedora-testing',
        ],
    },
    'cockpit-project/starter-kit': {
        'master': [
            'cockpit/centos-7',
            'cockpit/fedora-30',
        ],
    },
    'cockpit-project/cockpit-ostree': {
        'master': [
            'cockpit/fedora-atomic',
            'cockpit/continuous-atomic',
            'cockpit/rhel-atomic',
        ],
    },
    'cockpit-project/cockpit-podman': {
        'master': [
            'cockpit/fedora-29',
            'cockpit/fedora-30',
            'cockpit/rhel-8-1',
        ],
    },
    'weldr/lorax': {
        'master': [
            'cockpit/fedora-30',
            'cockpit/fedora-30/live-iso',
            'cockpit/fedora-30/qcow2',
            'cockpit/fedora-30/aws',
            'cockpit/fedora-30/openstack',
            'cockpit/fedora-30/vmware',
        ],
        '_manual': [
            'cockpit/fedora-30/azure',

            'cockpit/rhel-8-1',
            'cockpit/rhel-8-1/live-iso',
            'cockpit/rhel-8-1/qcow2',
            'cockpit/rhel-8-1/aws',
            'cockpit/rhel-8-1/azure',
            'cockpit/rhel-8-1/openstack',
            'cockpit/rhel-8-1/vmware',
        ],
        'rhel7-extras': [
            'cockpit/rhel-7-7',
            'cockpit/rhel-7-7/live-iso',
            'cockpit/rhel-7-7/qcow2',
            'cockpit/rhel-7-7/aws',
            'cockpit/rhel-7-7/azure',
            'cockpit/rhel-7-7/openstack',
            'cockpit/rhel-7-7/vmware',
        ],
    },
    'weldr/cockpit-composer': {
        'master': [
            'cockpit/fedora-30/chrome',
            'cockpit/fedora-30/firefox',
            'cockpit/fedora-30/edge',
            'cockpit/rhel-7-7/firefox',
            'cockpit/rhel-8-1/chrome',
        ],
        'rhel-8.0': ['cockpit/rhel-8-0/chrome', 'cockpit/rhel-8-0/firefox', 'cockpit/rhel-8-0/edge'
        ],
        'rhel-8.1': ['cockpit/rhel-8-1/chrome', 'cockpit/rhel-8-1/firefox', 'cockpit/rhel-8-1/edge'
        ],
    },
    'mvollmer/subscription-manager': {
        '_manual': [
            'cockpit/rhel-8-0',
        ],
    }
}

def projects():
    """Return all projects for which we run tests."""
    return REPO_BRANCH_CONTEXT.keys()

def tests_for_project(project):
    """Return branch -> contexts map."""
    return REPO_BRANCH_CONTEXT.get(project, {})
