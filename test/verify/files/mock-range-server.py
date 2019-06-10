# HTTPS server which accepts byte range option. (bytes=N-N)
#
# QEMU refuses to curl the url if server doesn't support range.
# https://lists.gnu.org/archive/html/qemu-devel/2013-06/msg02661.html
# https://github.com/qemu/qemu/blob/master/block/curl.c
#
# Standart python http server doesn't support range option, so we need to implement it manually.
#
# QEMU also doesn't accept http driver for certain distributions (block-drv-ro-whitelist option in qemu-kvm.spec).
# So server needs to be HTTPS.
#
# Sources:
# HTTP server with range option: https://gist.github.com/shivakar/82ac5c9cb17c95500db1906600e5e1ea/
# HTTPS server: https://www.piware.de/2011/01/creating-an-https-server-in-python/
#
# Usage example:
# $python3 mock-range-server.py cert-and-key.pem

import os
import sys
from http.server import SimpleHTTPRequestHandler, HTTPServer
import ssl


class RangeHTTPRequestHandler(SimpleHTTPRequestHandler):
    """RangeHTTPRequestHandler is a SimpleHTTPRequestHandler
    with HTTP 'Range' support"""

    def send_head(self):
        """Common code for GET and HEAD commands.
        Return value is either a file object or None
        """

        path = self.translate_path(self.path)
        ctype = self.guess_type(path)

        # Handling file location
        # If directory, let SimpleHTTPRequestHandler handle the request
        if os.path.isdir(path):
            return SimpleHTTPRequestHandler.send_head(self)

        # Handle file request
        f = open(path, 'rb')
        fs = os.fstat(f.fileno())
        size = fs[6]

        start, end = 0, size - 1
        if 'Range' in self.headers:
            start, end = self.headers.get('Range').strip().strip('bytes=').split('-')
        start = int(start)
        end = int(end)

        # Correct the values of start and end
        start = max(start, 0)
        end = min(end, size - 1)
        self.range = (start, end)
        # Setup headers and response
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range',
                         'bytes %s-%s/%s' % (start, end, size))
        self.send_header('Content-Length', str(length))
        self.send_header('Last-Modified', self.date_time_string(fs.st_mtime))
        self.end_headers()

        return f

    def copyfile(self, infile, outfile):
        """Copies data between two file objects
        If the current request is a 'Range' request then only the requested
        bytes are copied.
        Otherwise, the entire file is copied using SimpleHTTPServer.copyfile
        """

        start, end = self.range
        infile.seek(start)
        bufsize = 64 * 1024 # 64KB
        while True:
            buf = infile.read(bufsize)
            if not buf:
                break
            outfile.write(buf)


if __name__ == '__main__':
    httpd = HTTPServer(('localhost', 8000), RangeHTTPRequestHandler)
    httpd.socket = ssl.wrap_socket(httpd.socket, certfile=sys.argv[1], server_side=True)
    httpd.serve_forever()
