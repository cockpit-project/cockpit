const frames = { };

function click(ev) {
    const href = ev.target.getAttribute("href");
    ev.preventDefault();

    let address = document.getElementById("embed-address").value;
    if (address.indexOf(":") === -1)
        address += ":9090";
    const url = address + href;

    let frame = frames[url];
    if (!frame) {
        frame = frames[url] = document.createElement("iframe");
        frame.setAttribute("src", url);
        frame.setAttribute("name", ev.target.getAttribute("id"));
        document.getElementById("embed-here").appendChild(frame);
        frame.addEventListener("load", ev => ev.target.setAttribute("loaded", "1"));
    }

    document.querySelectorAll("iframe")
            .forEach(f => f.setAttribute("hidden", "hidden"));
    frame.removeAttribute("hidden");
    document.getElementById("embed-title").innerText = ev.target.innerText;
    return false;
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("#embed-links a[href]")
            .forEach(l => l.addEventListener("click", click));
});
