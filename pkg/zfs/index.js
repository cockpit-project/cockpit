function run(command) {
    return cockpit.spawn(command, { superuser: "require", err: "message" });
}

function escapeHtml(value) {
    return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
}

function renderTable(targetId, headers, rows) {
    const target = document.getElementById(targetId);
    if (!rows.length) {
        target.innerHTML = '<p class="zfs-muted">No data</p>';
        return;
    }

    const head = headers.map(header => `<th>${escapeHtml(header)}</th>`).join("");
    const body = rows.map(row => {
        const cols = row.map(value => `<td>${value}</td>`).join("");
        return `<tr>${cols}</tr>`;
    }).join("");

    target.innerHTML = `<table class="zfs-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function badge(value) {
    const lowered = String(value).toLowerCase();
    const ok = ["online", "active", "mounted", "yes"];
    const className = ok.includes(lowered) ? "zfs-state-ok" : "zfs-state-bad";
    return `<span class="${className}">${escapeHtml(value)}</span>`;
}

async function loadPoolSummary() {
    const output = await run(["zpool", "list", "-H", "-o", "name,size,alloc,free,health,frag,capacity"]);
    const rows = output.trim().split("\n").filter(Boolean).map(line => {
        const [name, size, alloc, free, health, frag, capacity] = line.split("\t");
        return [name, size, alloc, free, badge(health), frag, capacity];
    });
    renderTable("pool-summary", ["Pool", "Size", "Used", "Free", "Health", "Frag", "Cap"], rows);
}

async function loadDatasets() {
    const output = await run(["zfs", "list", "-H", "-o", "name,used,avail,mountpoint,mounted"]);
    const rows = output.trim().split("\n").filter(Boolean).map(line => {
        const [name, used, avail, mountpoint, mounted] = line.split("\t");
        return [name, used, avail, mountpoint, badge(mounted)];
    });
    renderTable("dataset-summary", ["Dataset", "Used", "Avail", "Mountpoint", "Mounted"], rows);
}

async function loadServices() {
    const services = [
        "zfs-load-module.service",
        "zfs-import-cache.service",
        "zfs-mount.service",
        "zfs-zed.service",
    ];

    const rows = [];
    for (const service of services) {
        try {
            const output = await run(["systemctl", "is-active", service]);
            rows.push([service, badge(output.trim())]);
        } catch (error) {
            rows.push([service, `<span class="zfs-error">${escapeHtml(error.message || String(error))}</span>`]);
        }
    }
    renderTable("service-summary", ["Service", "State"], rows);
}

async function loadStatus() {
    const output = await run(["zpool", "status"]);
    document.getElementById("pool-status").textContent = output.trim() || "No pool status output";
}

async function loadZedLog() {
    const output = await run(["journalctl", "-u", "zfs-zed.service", "-n", "30", "--no-pager"]);
    document.getElementById("zed-log").textContent = output.trim() || "No recent zed events";
}

async function refresh() {
    document.getElementById("pool-status").textContent = "Loading...";
    document.getElementById("zed-log").textContent = "Loading...";

    try {
        await Promise.all([
            loadPoolSummary(),
            loadDatasets(),
            loadServices(),
            loadStatus(),
            loadZedLog(),
        ]);
    } catch (error) {
        const message = error.message || String(error);
        document.getElementById("pool-status").textContent = `Error: ${message}`;
        document.getElementById("zed-log").textContent = `Error: ${message}`;
    }
}

document.getElementById("refresh").addEventListener("click", refresh);
refresh();
