var frames = { };

function click(ev) {
  var href = ev.target.getAttribute("href");
  ev.preventDefault();

  var address = document.getElementById("embed-address").value;
  if (address.indexOf(":") === -1)
    address += ":9090";
  var url = address + href;

  var frame = frames[url];
  if (!frame) {
    frame = frames[url] = document.createElement("iframe");
    frame.setAttribute("src", url)
    frame.setAttribute("name", ev.target.getAttribute("id"));
    document.getElementById("embed-here").appendChild(frame);
    frame.addEventListener("load", function(ev) {
      ev.target.setAttribute("loaded", "1");
    });
  }

  var i, iframes = document.querySelectorAll("iframe");
  for (i = 0; i < iframes.length; i++)
    iframes[i].setAttribute("hidden", "hidden");
  frame.removeAttribute("hidden");
  document.getElementById("embed-title").innerText = ev.target.innerText;
  return false;
}

document.addEventListener("DOMContentLoaded", function() {
  var x, links = document.querySelectorAll("#embed-links a[href]");
  for (x = 0; x < links.length; x++)
    links[x].addEventListener("click", click);
});
