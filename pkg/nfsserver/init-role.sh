set -e

# This is a hack to put a trivial nfs-server role into the system,
# just for the PoC.
#
# XXX - This role doesn't actually unexport a filesystem when it is
#       removed from the configuration.

dir=/var/lib/playbooks/roles/nfs-server

if ! test -d "$dir"; then
    mkdir -p "$dir"

    mkdir "$dir/tasks"
    cat >"$dir/tasks/main.yml" <<'EOF'
---
- name: Write config
  template: src=exports.j2 dest=/etc/exports.d/nfs-server.exports
- name: Unexport everything
  command: exportfs -a -u
- name: Export everything
  command: exportfs -a
EOF

    mkdir "$dir/templates"
    cat >"$dir/templates/exports.j2" <<'EOF'
# Created by the nfs-server sysmgmt role.  Do not edit.
{% for folder, options in shares.iteritems() %}
{{ folder }} {{ options.hosts }}(rw)
{% endfor %}
EOF
fi
